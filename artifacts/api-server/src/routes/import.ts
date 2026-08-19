import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import {
  ImportVideoBody,
  ImportVideoParams,
  ImportVideoResponse,
} from "@workspace/api-zod";
import { importVideoFromUrl } from "../lib/import";
import { getVideoStorage } from "../lib/storage";
import { getVideoOr404, getVideoAssignments, serializeVideo } from "../lib/video-library";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Import a video binary from a direct file URL. The downloaded file follows
// the same lifecycle as an upload: it lands in PENDING_REVIEW and requires a
// fresh manual review before members can see it.
router.post("/:id/import", async (req: Request, res: Response) => {
  const { id } = ImportVideoParams.parse(req.params);
  const body = ImportVideoBody.parse(req.body);
  const video = await getVideoOr404(id);

  let result;
  try {
    result = await importVideoFromUrl(id, body.url);
  } catch (err) {
    throw err;
  }

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

  const now = new Date();
  const [updated] = await db
    .update(videosTable)
    .set({
      storage_key: result.key,
      storage_provider: getVideoStorage().provider,
      mime_type: result.mimeType,
      original_file_name: result.fileName,
      size_bytes: result.sizeBytes,
      status: "PENDING_REVIEW",
      pending_review_at: now,
      approved_at: null,
      rejected_at: null,
      updated_at: now,
    })
    .where(eq(videosTable.id, id))
    .returning();

  const assignments = await getVideoAssignments([id]);
  res.json(ImportVideoResponse.parse(serializeVideo(updated, assignments)));
});

export default router;
