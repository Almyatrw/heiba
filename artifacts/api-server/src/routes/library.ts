import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, videoGroupsTable, videosTable } from "@workspace/db";
import {
  GetLibraryVideoParams,
  ListLibraryVideosQueryParams,
  ListLibraryVideosResponse,
} from "@workspace/api-zod";
import { notFound } from "../lib/errors";
import {
  assignmentFilters,
  canSeeInLibrary,
  getVideoAssignments,
  getVideoOr404,
  isAdmin,
  memberGroupIds,
  serializeVideo,
} from "../lib/video-library";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/videos", requireAuth, async (req: Request, res: Response) => {
  const query = ListLibraryVideosQueryParams.parse(req.query);
  const user = req.auth!.user;

  const conditions = [eq(videosTable.status, "APPROVED")];

  if (!isAdmin(user)) {
    const groupIds = await memberGroupIds(user.id);
    if (groupIds.length === 0) {
      res.json(ListLibraryVideosResponse.parse({ videos: [], total: 0 }));
      return;
    }
    conditions.push(
      inArray(
        videosTable.id,
        db
          .select({ id: videoGroupsTable.video_id })
          .from(videoGroupsTable)
          .where(inArray(videoGroupsTable.group_id, groupIds)),
      ),
    );
  }

  const assignmentCondition = assignmentFilters(query.groupId, query.categoryId);
  if (assignmentCondition) conditions.push(assignmentCondition);

  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(
      or(
        ilike(videosTable.title, pattern),
        ilike(videosTable.description, pattern),
      )!,
    );
  }

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
    ListLibraryVideosResponse.parse({
      videos: rows.map((v) => serializeVideo(v, assignments)),
      total: totalRow?.value ?? 0,
    }),
  );
});

router.get("/videos/:id", requireAuth, async (req: Request, res: Response) => {
  const { id } = GetLibraryVideoParams.parse(req.params);
  const user = req.auth!.user;
  const video = await getVideoOr404(id);
  // Do not leak existence of hidden/unapproved videos
  if (!(await canSeeInLibrary(user, video))) throw notFound("Video not found");

  const assignments = await getVideoAssignments([id]);
  res.json(serializeVideo(video, assignments));
});

export default router;
