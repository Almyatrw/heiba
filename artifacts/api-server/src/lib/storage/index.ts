import type { Readable } from "node:stream";
import { LocalVideoStorage } from "./local";
import { R2VideoStorage, r2ConfigFromEnv } from "./r2";

// Storage abstraction: video binaries live OUTSIDE PostgreSQL, always behind
// this interface. The default development provider is the local filesystem;
// Cloudflare R2 (S3-compatible) is the production provider, selected via
// VIDEO_STORAGE_PROVIDER=r2 + R2_* env vars. Business logic never talks to a
// vendor SDK directly — only to VideoStorage.
export interface ByteRange {
  start: number;
  end: number;
}

export interface PreparedPart {
  partNumber: number;
  url: string;
}

export interface PreparedDirectUpload {
  mode: "single" | "multipart";
  /** Presigned URL for single-PUT uploads. */
  url?: string;
  /** Provider-side multipart upload id; null for single-PUT. */
  providerUploadId: string | null;
  parts: PreparedPart[];
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface VideoStorage {
  readonly provider: string;
  save(key: string, stream: Readable): Promise<{ sizeBytes: number }>;
  openReadStream(key: string, range?: ByteRange): Promise<Readable>;
  stat(key: string): Promise<{ sizeBytes: number } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;

  /**
   * Direct browser → object storage uploads. Providers that support
   * presigning (R2) return true from supportsDirectUpload; others omit the
   * methods below and clients fall back to the server-mediated upload.
   */
  supportsDirectUpload?(): boolean;
  prepareDirectUpload?(
    key: string,
    opts: { sizeBytes: number; mimeType: string },
  ): Promise<PreparedDirectUpload>;
  completeDirectUpload?(
    key: string,
    providerUploadId: string | null,
    parts: CompletedPart[],
  ): Promise<{ sizeBytes: number }>;
  abortDirectUpload?(key: string, providerUploadId: string): Promise<void>;
}

let storage: VideoStorage | null = null;

export function getVideoStorage(): VideoStorage {
  if (!storage) {
    const provider = process.env.VIDEO_STORAGE_PROVIDER ?? "local";
    if (provider === "r2") {
      const config = r2ConfigFromEnv();
      if (!config) {
        throw new Error(
          "VIDEO_STORAGE_PROVIDER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET",
        );
      }
      storage = new R2VideoStorage(config);
    } else if (provider === "local") {
      storage = new LocalVideoStorage(
        process.env.VIDEO_STORAGE_DIR ?? "storage",
      );
    } else {
      throw new Error(`Unknown VIDEO_STORAGE_PROVIDER: ${provider}`);
    }
  }
  return storage;
}

/** Test hook: replace the storage backend. */
export function setVideoStorageForTests(next: VideoStorage | null): void {
  storage = next;
}
