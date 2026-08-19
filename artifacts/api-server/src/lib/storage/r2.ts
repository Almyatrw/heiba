import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ByteRange,
  VideoStorage,
  PreparedDirectUpload,
  PreparedPart,
  CompletedPart,
} from "./index";

export const R2_PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const R2_SINGLE_PUT_LIMIT_BYTES = 64 * 1024 * 1024; // below this, one PUT is enough
const MAX_PARTS = 1000;
const PRESIGN_TTL_SECONDS = 60 * 60; // 1 hour per URL

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

/** Reads the R2 config from the environment; null when not configured. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    endpoint: env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: (env.R2_PREFIX ?? "videos").replace(/\/+$/, ""),
  };
}

// Cloudflare R2 (S3-compatible) production storage provider. Credentials never
// leave the server: the browser only ever sees short-lived presigned URLs, and
// playback is proxied through the authenticated API (objects stay private).
export class R2VideoStorage implements VideoStorage {
  readonly provider = "r2";

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: R2Config, client?: S3Client) {
    this.bucket = config.bucket;
    this.prefix = config.prefix;
    this.client =
      client ??
      new S3Client({
        region: "auto",
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  buildKey(videoId: number, extension: string, objectId: string): string {
    const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return `${this.prefix}/${videoId}/${objectId}${safeExt ? `.${safeExt}` : ""}`;
  }

  private params(key: string) {
    return { Bucket: this.bucket, Key: key };
  }

  async save(key: string, stream: Readable): Promise<{ sizeBytes: number }> {
    await this.client.send(
      new PutObjectCommand({ ...this.params(key), Body: stream }),
    );
    const stat = await this.stat(key);
    return { sizeBytes: stat?.sizeBytes ?? 0 };
  }

  async openReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({
        ...this.params(key),
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!out.Body) throw new Error(`empty body for ${key}`);
    return out.Body as Readable;
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand(this.params(key)),
      );
      return { sizeBytes: Number(out.ContentLength ?? 0) };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand(this.params(key)));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  supportsDirectUpload(): boolean {
    return true;
  }

  async prepareDirectUpload(
    key: string,
    opts: { sizeBytes: number; mimeType: string },
  ): Promise<PreparedDirectUpload> {
    const partCount = Math.ceil(opts.sizeBytes / R2_PART_SIZE_BYTES);

    if (partCount <= 1 && opts.sizeBytes <= R2_SINGLE_PUT_LIMIT_BYTES) {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          ...this.params(key),
          ContentType: opts.mimeType,
        }),
        { expiresIn: PRESIGN_TTL_SECONDS },
      );
      return { mode: "single", url, providerUploadId: null, parts: [] };
    }

    if (partCount > MAX_PARTS) {
      throw new Error(`file too large: ${partCount} parts would exceed ${MAX_PARTS}`);
    }

    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        ...this.params(key),
        ContentType: opts.mimeType,
      }),
    );
    if (!created.UploadId) throw new Error("R2 did not return an upload id");

    const parts: PreparedPart[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      // eslint-disable-next-line no-await-in-loop -- presigning is cheap and local
      const url = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          ...this.params(key),
          UploadId: created.UploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PRESIGN_TTL_SECONDS },
      );
      parts.push({ partNumber, url });
    }

    return {
      mode: "multipart",
      providerUploadId: created.UploadId,
      parts,
    };
  }

  async completeDirectUpload(
    key: string,
    providerUploadId: string | null,
    parts: CompletedPart[],
  ): Promise<{ sizeBytes: number }> {
    if (providerUploadId) {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          ...this.params(key),
          UploadId: providerUploadId,
          MultipartUpload: {
            Parts: parts
              .slice()
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    }
    const stat = await this.stat(key);
    if (!stat) throw new Error(`object ${key} not found after upload`);
    return stat;
  }

  async abortDirectUpload(key: string, providerUploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        ...this.params(key),
        UploadId: providerUploadId,
      }),
    );
  }
}
