import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db, videosTable, videoUploadsTable } from "@workspace/db";
import {
  CreateDirectUploadBody,
  CreateDirectUploadParams,
  CreateDirectUploadResponse,
  CompleteDirectUploadBody,
  CompleteDirectUploadParams,
  AbortDirectUploadParams,
  GetUploadCapabilitiesParams,
  GetUploadCapabilitiesResponse,
  UploadVideoFileResponse,
} from "@workspace/api-zod";
import { badRequest, payloadTooLarge } from "../lib/errors";
import { getVideoStorage } from "../lib/storage";
import { R2_PART_SIZE_BYTES, R2_SINGLE_PUT_LIMIT_BYTES } from "../lib/storage/r2";
import { getVideoOr404, serializeVideo, getVideoAssignments } from "../lib/video-library";
import { maxUploadBytes } from "../lib/uploads";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/quicktime": ".mov",
};

const UPLOAD_JOB_TTL_MS = 24 * 60 * 60 * 1000;

function abortStaleUploads(videoId: number): void {
  // Cleanup of abandoned multipart uploads: jobs past their 24h expiry are
  // aborted at the provider and marked ABORTED. Runs before each new job.
  void (async () => {
    const stale = await db
      .select()
      .from(videoUploadsTable)
      .where(
        and(
          eq(videoUploadsTable.video_id, videoId),
          eq(videoUploadsTable.status, "INITIATED"),
          lt(videoUploadsTable.expires_at, new Date()),
        ),
      );
    for (const job of stale) {
      if (job.provider_upload_id) {
        try {
          await getVideoStorage().abortDirectUpload?.(
            job.storage_key,
            job.provider_upload_id,
          );
        } catch (err) {
          logger.warn(
            { err, jobId: job.id },
            "failed to abort stale multipart upload",
          );
        }
      }
      await db
        .update(videoUploadsTable)
        .set({ status: "ABORTED", updated_at: new Date() })
        .where(eq(videoUploadsTable.id, job.id));
    }
  })().catch((err) => logger.error({ err }, "stale upload cleanup failed"));
}

// Capabilities tell the SPA whether it can use presigned direct uploads
// (R2) or must fall back to the server-mediated proxy upload (local dev).
router.get("/:id/upload-capabilities", (req: Request, res: Response) => {
  const { id } = GetUploadCapabilitiesParams.parse(req.params);
  const storage = getVideoStorage();
  res.json(
    GetUploadCapabilitiesResponse.parse({
      directUploadSupported: storage.supportsDirectUpload?.() ?? false,
      maxBytes: maxUploadBytes(),
      multipartPartSize: R2_PART_SIZE_BYTES,
      singlePutLimit: R2_SINGLE_PUT_LIMIT_BYTES,
    }),
  );
});

router.post("/:id/direct-upload", async (req: Request, res: Response) => {
  const { id } = CreateDirectUploadParams.parse(req.params);
  const body = CreateDirectUploadBody.parse(req.body);
  await getVideoOr404(id);

  const storage = getVideoStorage();
  if (!storage.supportsDirectUpload?.() || !storage.prepareDirectUpload) {
    throw badRequest(
      `Storage provider "${storage.provider}" does not support direct uploads; use POST /videos/:id/file`,
    );
  }
  if (body.sizeBytes <= 0 || !Number.isFinite(body.sizeBytes)) {
    throw badRequest("sizeBytes must be a positive number");
  }
  if (body.sizeBytes > maxUploadBytes()) {
    throw payloadTooLarge(
      `Video exceeds the ${maxUploadBytes()}-byte upload limit`,
    );
  }
  const ext = EXT_BY_MIME[body.mimeType?.toLowerCase() ?? ""];
  if (!ext) {
    throw badRequest(
      `Unsupported media type "${body.mimeType}". Allowed: mp4, webm, mkv, mov`,
    );
  }

  abortStaleUploads(id);

  const key = `videos/${id}/${randomBytes(8).toString("hex")}${ext}`;
  const prepared = await storage.prepareDirectUpload(key, {
    sizeBytes: body.sizeBytes,
    mimeType: body.mimeType,
  });

  const expiresAt = new Date(Date.now() + UPLOAD_JOB_TTL_MS);
  const [job] = await db
    .insert(videoUploadsTable)
    .values({
      video_id: id,
      storage_key: key,
      provider_upload_id: prepared.providerUploadId,
      part_count: Math.max(1, prepared.parts.length),
      declared_size_bytes: body.sizeBytes,
      file_name: body.fileName,
      mime_type: body.mimeType,
      expires_at: expiresAt,
    })
    .returning();

  res.json(
    CreateDirectUploadResponse.parse({
      uploadId: job.id,
      mode: prepared.mode,
      url: prepared.url,
      parts: prepared.parts,
    }),
  );
});

router.post(
  "/:id/direct-upload/:uploadId/complete",
  async (req: Request, res: Response) => {
    const { id, uploadId } = CompleteDirectUploadParams.parse(req.params);
    const body = CompleteDirectUploadBody.parse(req.body ?? {});
    const video = await getVideoOr404(id);

    const [job] = await db
      .select()
      .from(videoUploadsTable)
      .where(
        and(
          eq(videoUploadsTable.id, uploadId),
          eq(videoUploadsTable.video_id, id),
        ),
      );
    if (!job) throw badRequest("Upload job not found for this video");
    if (job.status !== "INITIATED") {
      throw badRequest(`Upload job is already ${job.status.toLowerCase()}`);
    }
    if (job.expires_at < new Date()) {
      throw badRequest("Upload job has expired; start a new upload");
    }
    if (!getVideoStorage().completeDirectUpload) {
      throw badRequest("Storage provider does not support direct uploads");
    }

    let sizeBytes: number;
    try {
      ({ sizeBytes } = await getVideoStorage().completeDirectUpload!(
        job.storage_key,
        job.provider_upload_id,
        body.parts ?? [],
      ));
    } catch (err) {
      logger.warn({ err, uploadId }, "direct upload completion failed");
      throw badRequest("Could not complete the upload on storage");
    }

    // Replace the previous binary
    if (video.storage_key && video.storage_key !== job.storage_key) {
      try {
        await getVideoStorage().delete(video.storage_key);
      } catch (err) {
        logger.error(
          { err, videoId: id, storageKey: video.storage_key },
          "failed to delete replaced video object",
        );
      }
    }

    const now = new Date();
    await db
      .update(videoUploadsTable)
      .set({ status: "COMPLETED", updated_at: now })
      .where(eq(videoUploadsTable.id, job.id));

    const [updated] = await db
      .update(videosTable)
      .set({
        storage_key: job.storage_key,
        storage_provider: getVideoStorage().provider,
        mime_type: job.mime_type,
        original_file_name: job.file_name,
        size_bytes: sizeBytes,
        status: "PENDING_REVIEW",
        pending_review_at: now,
        approved_at: null,
        rejected_at: null,
        updated_at: now,
      })
      .where(eq(videosTable.id, id))
      .returning();

    const assignments = await getVideoAssignments([id]);
    res.json(UploadVideoFileResponse.parse(serializeVideo(updated, assignments)));
  },
);

router.post(
  "/:id/direct-upload/:uploadId/abort",
  async (req: Request, res: Response) => {
    const { id, uploadId } = AbortDirectUploadParams.parse(req.params);
    await getVideoOr404(id);

    const [job] = await db
      .select()
      .from(videoUploadsTable)
      .where(
        and(
          eq(videoUploadsTable.id, uploadId),
          eq(videoUploadsTable.video_id, id),
        ),
      );
    if (!job) throw badRequest("Upload job not found for this video");

    if (job.provider_upload_id) {
      try {
        await getVideoStorage().abortDirectUpload?.(
          job.storage_key,
          job.provider_upload_id,
        );
      } catch (err) {
        logger.warn({ err, uploadId }, "provider abort failed");
      }
    }
    await db
      .update(videoUploadsTable)
      .set({ status: "ABORTED", updated_at: new Date() })
      .where(eq(videoUploadsTable.id, job.id));

    res.status(204).end();
  },
);

export default router;
