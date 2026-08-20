import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import {
  ImportVideoBody,
  ImportVideoParams,
  ImportVideoResponse,
  GetImportStatusParams,
  GetImportStatusResponse,
} from "@workspace/api-zod";
import {
  getImportJobStatus,
  importVideoFromUrl,
  setImportJobStatus,
  validateImportUrl,
} from "../lib/import";
import { getVideoStorage } from "../lib/storage";
import { getVideoOr404, getVideoAssignments, serializeVideo } from "../lib/video-library";
import { badRequest } from "../lib/errors";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface ImportMeta {
  import?: {
    provider: string;
    sourceUrl: string;
    state: string;
    error: string | null;
    updatedAt: string;
  };
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown import error";
}

// Import a video binary from a URL. The download runs in the background: the
// video row moves PROCESSING → PENDING_REVIEW on success (fresh manual
// review required) or → FAILED with the reason stored in storage_meta.
router.post("/:id/import", async (req: Request, res: Response) => {
  const { id } = ImportVideoParams.parse(req.params);
  const body = ImportVideoBody.parse(req.body);
  const video = await getVideoOr404(id);

  // Validate synchronously so invalid/unsupported URLs fail fast.
  const { provider } = validateImportUrl(body.url);

  const existing = getImportJobStatus(id);
  if (existing && (existing.state === "QUEUED" || existing.state === "PROCESSING")) {
    throw badRequest("An import is already in progress for this video");
  }

  const now = new Date();
  const [queued] = await db
    .update(videosTable)
    .set({
      status: "PROCESSING",
      processing_started_at: now,
      pending_review_at: null,
      approved_at: null,
      rejected_at: null,
      updated_at: now,
      storage_meta: {
        ...((video.storage_meta as ImportMeta | null) ?? {}),
        import: {
          provider: provider.name,
          sourceUrl: body.url,
          state: "QUEUED",
          error: null,
          updatedAt: now.toISOString(),
        },
      },
    })
    .where(eq(videosTable.id, id))
    .returning();

  setImportJobStatus(id, { state: "QUEUED", provider: provider.name, error: null });

  // Fire-and-forget background import. Never awaited by the request.
  void (async () => {
    setImportJobStatus(id, { state: "PROCESSING", provider: provider.name, error: null });
    try {
      const result = await importVideoFromUrl(id, body.url);

      if (video.storage_key && video.storage_key !== result.key) {
        try {
          await getVideoStorage().delete(video.storage_key);
        } catch (err) {
          logger.error(
            { err, videoId: id, storageKey: video.storage_key },
            "failed to delete replaced video object",
          );
        }
      }

      const doneAt = new Date();
      await db
        .update(videosTable)
        .set({
          storage_key: result.key,
          storage_provider: getVideoStorage().provider,
          mime_type: result.mimeType,
          original_file_name: result.fileName,
          size_bytes: result.sizeBytes,
          status: "PENDING_REVIEW",
          pending_review_at: doneAt,
          approved_at: null,
          rejected_at: null,
          updated_at: doneAt,
          storage_meta: {
            import: {
              provider: result.provider,
              sourceUrl: body.url,
              state: "COMPLETED",
              error: null,
              updatedAt: doneAt.toISOString(),
            },
          },
        })
        .where(eq(videosTable.id, id));
      setImportJobStatus(id, {
        state: "COMPLETED",
        provider: result.provider,
        error: null,
      });
    } catch (err) {
      const message = errorMessage(err);
      logger.warn({ err, videoId: id }, "url import failed");
      const failedAt = new Date();
      await db
        .update(videosTable)
        .set({
          status: "FAILED",
          updated_at: failedAt,
          storage_meta: {
            import: {
              provider: provider.name,
              sourceUrl: body.url,
              state: "FAILED",
              error: message.slice(0, 500),
              updatedAt: failedAt.toISOString(),
            },
          },
        })
        .where(eq(videosTable.id, id))
        .catch((dbErr) =>
          logger.error({ err: dbErr, videoId: id }, "failed to record import failure"),
        );
      setImportJobStatus(id, { state: "FAILED", provider: provider.name, error: message });
    }
  })();

  const assignments = await getVideoAssignments([id]);
  res.status(202).json(ImportVideoResponse.parse(serializeVideo(queued, assignments)));
});

// Import progress for the current video: in-process job state first, falling
// back to the persisted storage_meta so the UI stays correct after restarts.
router.get("/:id/import-status", async (req: Request, res: Response) => {
  const { id } = GetImportStatusParams.parse(req.params);
  const video = await getVideoOr404(id);

  const inMemory = getImportJobStatus(id);
  const persisted = (video.storage_meta as ImportMeta | null)?.import;

  const job = inMemory ?? persisted ?? null;
  res.json(
    GetImportStatusResponse.parse({
      state: job?.state ?? null,
      provider: job?.provider ?? null,
      error: job?.error ?? null,
      videoStatus: video.status,
      updatedAt: job?.updatedAt ?? null,
    }),
  );
});

export default router;
