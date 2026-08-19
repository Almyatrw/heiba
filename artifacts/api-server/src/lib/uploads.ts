import { randomBytes } from "node:crypto";
import type { Request } from "express";
import Busboy from "busboy";
import { badRequest, payloadTooLarge } from "./errors";
import { getVideoStorage } from "./storage";

// Accepted upload types. Extension is derived from the verified MIME type,
// never from the client-supplied filename.
const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/quicktime": ".mov",
};

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export interface ReceivedVideoFile {
  key: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
}

export function maxUploadBytes(): number {
  const raw = Number(process.env.VIDEO_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_BYTES;
}

// Streams a single multipart "file" field straight into the storage
// abstraction — video bytes never touch PostgreSQL or server memory buffers.
export function receiveVideoUpload(
  req: Request,
  videoId: number,
): Promise<ReceivedVideoFile> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const succeed = (value: ReceivedVideoFile) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxUploadBytes() },
      });
    } catch {
      fail(badRequest("Expected a multipart/form-data request"));
      return;
    }

    let fileSeen = false;
    busboy.on("file", (field, stream, info) => {
      if (field !== "file") {
        stream.resume();
        return;
      }
      fileSeen = true;
      const mimeType = info.mimeType.toLowerCase();
      const ext = VIDEO_MIME_EXTENSIONS[mimeType];
      if (!ext) {
        // Drain so the request can complete, then report the rejection
        stream.resume();
        fail(
          badRequest(
            `Unsupported media type "${info.mimeType}". Allowed: mp4, webm, mkv, mov`,
          ),
        );
        return;
      }
      let hitLimit = false;
      stream.on("limit", () => {
        hitLimit = true;
      });
      const key = `videos/${videoId}/${randomBytes(8).toString("hex")}${ext}`;
      void (async () => {
        try {
          const { sizeBytes } = await getVideoStorage().save(key, stream);
          if (hitLimit) {
            await getVideoStorage().delete(key);
            fail(
              payloadTooLarge(
                `Video exceeds the ${maxUploadBytes()}-byte upload limit`,
              ),
            );
            return;
          }
          succeed({ key, mimeType, fileName: info.filename || null, sizeBytes });
        } catch (err) {
          fail(err);
        }
      })();
    });
    busboy.on("error", fail);
    busboy.on("finish", () => {
      // Parsing is done; if the storage write is still in flight its
      // succeed/fail will settle the promise — never settle here.
      if (!fileSeen) fail(badRequest("Missing multipart file field 'file'"));
    });
    req.pipe(busboy);
  });
}
