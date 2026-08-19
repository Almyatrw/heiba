import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db, videoReviewsTable, videosTable } from "@workspace/db";
import {
  ListPendingReviewsQueryParams,
  ListPendingReviewsResponse,
  ListVideoReviewsParams,
  ListVideoReviewsResponse,
  ReviewVideoBody,
  ReviewVideoParams,
  ReviewVideoResponse,
} from "@workspace/api-zod";
import { conflict } from "../lib/errors";
import { toReviewRecord } from "../lib/serializers";
import {
  getVideoAssignments,
  getVideoOr404,
  serializeVideo,
} from "../lib/video-library";
import { requireAuth, requireRole } from "../middlewares/auth";

// Manual review only — there is intentionally NO automatic moderation anywhere
// in the platform. Every status transition is a human decision, stored in
// video_reviews.
export const reviewsRouter: IRouter = Router();
export const videoReviewsRouter: IRouter = Router();

reviewsRouter.use(requireAuth, requireRole("OWNER", "ADMIN"));
videoReviewsRouter.use(requireAuth, requireRole("OWNER", "ADMIN"));

const REVIEWABLE_STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED"] as const;

// Pending queue: oldest submissions first.
reviewsRouter.get("/pending", async (req: Request, res: Response) => {
  const query = ListPendingReviewsQueryParams.parse(req.query);
  const pending = eq(videosTable.status, "PENDING_REVIEW");

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(videosTable)
      .where(pending)
      .orderBy(asc(videosTable.pending_review_at), asc(videosTable.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(videosTable).where(pending),
  ]);

  const assignments = await getVideoAssignments(rows.map((v) => v.id));
  res.json(
    ListPendingReviewsResponse.parse({
      videos: rows.map((v) => serializeVideo(v, assignments)),
      total: totalRow?.value ?? 0,
    }),
  );
});

// Approve or reject a video. Re-reviews are allowed (REJECTED -> APPROVED,
// APPROVED -> REJECTED for takedowns); every decision is recorded.
videoReviewsRouter.post("/:id/review", async (req: Request, res: Response) => {
  const { id } = ReviewVideoParams.parse(req.params);
  const body = ReviewVideoBody.parse(req.body);
  const reviewer = req.auth!.user;
  const video = await getVideoOr404(id);

  if (!video.storage_key) {
    throw conflict("Video has no uploaded file yet");
  }
  if (!REVIEWABLE_STATUSES.includes(video.status as (typeof REVIEWABLE_STATUSES)[number])) {
    throw conflict(
      `Video cannot be reviewed while ${video.status.toLowerCase()}`,
    );
  }

  const now = new Date();
  const approved = body.action === "APPROVED";

  const [updated] = await db
    .update(videosTable)
    .set({
      status: approved ? "APPROVED" : "REJECTED",
      approved_at: approved ? now : video.approved_at,
      rejected_at: approved ? video.rejected_at : now,
      updated_at: now,
    })
    .where(
      and(
        eq(videosTable.id, id),
        inArray(videosTable.status, [...REVIEWABLE_STATUSES]),
      ),
    )
    .returning();
  if (!updated) {
    // Concurrent transition between read and write
    throw conflict("Video state changed; reload and try again");
  }

  await db.insert(videoReviewsTable).values({
    video_id: id,
    reviewer_id: reviewer.id,
    action: body.action,
    notes: body.notes ?? null,
  });

  const assignments = await getVideoAssignments([id]);
  res.json(ReviewVideoResponse.parse(serializeVideo(updated, assignments)));
});

videoReviewsRouter.get(
  "/:id/reviews",
  async (req: Request, res: Response) => {
    const { id } = ListVideoReviewsParams.parse(req.params);
    await getVideoOr404(id);
    const rows = await db
      .select()
      .from(videoReviewsTable)
      .where(eq(videoReviewsTable.video_id, id))
      .orderBy(desc(videoReviewsTable.created_at), desc(videoReviewsTable.id));
    res.json(
      ListVideoReviewsResponse.parse({ reviews: rows.map(toReviewRecord) }),
    );
  },
);
