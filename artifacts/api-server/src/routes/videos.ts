import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import {
  CreateVideoBody,
  CreateVideoResponse,
  DeleteVideoParams,
  GetVideoParams,
  GetVideoResponse,
  ListVideosQueryParams,
  ListVideosResponse,
  UpdateVideoBody,
  UpdateVideoParams,
  UpdateVideoResponse,
  UploadVideoFileParams,
  UploadVideoFileResponse,
} from "@workspace/api-zod";
import { getVideoStorage } from "../lib/storage";
import { receiveVideoUpload } from "../lib/uploads";
import {
  assignmentFilters,
  getVideoAssignments,
  getVideoOr404,
  replaceVideoAssignments,
  serializeVideo,
} from "../lib/video-library";
import { logger } from "../lib/logger";
import { requireAuth, requireRole } from "../middlewares/auth";
import importRouter from "./import";
import directUploadsRouter from "./direct-uploads";

const router: IRouter = Router();

// All /videos management endpoints are OWNER/ADMIN only. Members get the
// filtered library endpoints in Phase 3.
router.use(requireAuth, requireRole("OWNER", "ADMIN"));

// Import + direct-upload routes share this auth boundary (mounted before the
// generic /:id handlers so their static suffixes always win).
router.use(importRouter);
router.use(directUploadsRouter);

router.get("/", async (req: Request, res: Response) => {
  const query = ListVideosQueryParams.parse(req.query);
  const assignmentCondition = assignmentFilters(query.groupId, query.categoryId);
  const conditions = [
    ...(query.status ? [eq(videosTable.status, query.status)] : []),
    ...(assignmentCondition ? [assignmentCondition] : []),
  ];

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(videosTable)
      .where(and(...conditions))
      .orderBy(desc(videosTable.created_at), asc(videosTable.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(videosTable).where(and(...conditions)),
  ]);

  const assignments = await getVideoAssignments(rows.map((v) => v.id));
  res.json(
    ListVideosResponse.parse({
      videos: rows.map((v) => serializeVideo(v, assignments)),
      total: totalRow?.value ?? 0,
    }),
  );
});

router.post("/", async (req: Request, res: Response) => {
  const body = CreateVideoBody.parse(req.body);
  const user = req.auth!.user;

  const now = new Date();
  const [video] = await db
    .insert(videosTable)
    .values({
      title: body.title,
      description: body.description ?? null,
      tags: body.tags ?? [],
      owner_id: user.id,
      status: "PROCESSING",
      processing_started_at: now,
    })
    .returning();

  await replaceVideoAssignments(video.id, body.categoryIds, body.groupIds);

  const assignments = await getVideoAssignments([video.id]);
  res
    .status(201)
    .json(CreateVideoResponse.parse(serializeVideo(video, assignments)));
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = GetVideoParams.parse(req.params);
  const video = await getVideoOr404(id);
  const assignments = await getVideoAssignments([id]);
  res.json(GetVideoResponse.parse(serializeVideo(video, assignments)));
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { id } = UpdateVideoParams.parse(req.params);
  const body = UpdateVideoBody.parse(req.body);
  await getVideoOr404(id);

  const [video] = await db
    .update(videosTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      updated_at: new Date(),
    })
    .where(eq(videosTable.id, id))
    .returning();

  await replaceVideoAssignments(id, body.categoryIds, body.groupIds);

  const assignments = await getVideoAssignments([id]);
  res.json(UpdateVideoResponse.parse(serializeVideo(video, assignments)));
});

router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = DeleteVideoParams.parse(req.params);
  const video = await getVideoOr404(id);

  await db.delete(videosTable).where(eq(videosTable.id, id));
  if (video.storage_key) {
    try {
      await getVideoStorage().delete(video.storage_key);
    } catch (err) {
      logger.error(
        { err, videoId: id, storageKey: video.storage_key },
        "failed to delete stored video object",
      );
    }
  }
  res.status(204).end();
});

// Upload the binary. The video moves to PENDING_REVIEW once stored; every
// re-upload requires a fresh manual review.
router.post("/:id/file", async (req: Request, res: Response) => {
  const { id } = UploadVideoFileParams.parse(req.params);
  const video = await getVideoOr404(id);

  const received = await receiveVideoUpload(req, id);

  if (video.storage_key && video.storage_key !== received.key) {
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
      storage_key: received.key,
      storage_provider: getVideoStorage().provider,
      mime_type: received.mimeType,
      original_file_name: received.fileName,
      size_bytes: received.sizeBytes,
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
});

export default router;
