import { and, eq, inArray } from "drizzle-orm";
import {
  categoriesTable,
  db,
  groupsTable,
  videoCategoriesTable,
  videoGroupsTable,
  videosTable,
  type Video,
} from "@workspace/db";
import { badRequest, notFound } from "./errors";
import { toAdminVideo } from "./serializers";

export async function getVideoOr404(id: number): Promise<Video> {
  const [video] = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, id))
    .limit(1);
  if (!video) throw notFound("Video not found");
  return video;
}

export async function getVideoAssignments(videoIds: number[]): Promise<{
  categoryIds: Map<number, number[]>;
  groupIds: Map<number, number[]>;
}> {
  const categoryIds = new Map<number, number[]>();
  const groupIds = new Map<number, number[]>();
  if (videoIds.length === 0) return { categoryIds, groupIds };

  const [catRows, groupRows] = await Promise.all([
    db
      .select()
      .from(videoCategoriesTable)
      .where(inArray(videoCategoriesTable.video_id, videoIds)),
    db
      .select()
      .from(videoGroupsTable)
      .where(inArray(videoGroupsTable.video_id, videoIds)),
  ]);
  for (const row of catRows) {
    categoryIds.set(row.video_id, [
      ...(categoryIds.get(row.video_id) ?? []),
      row.category_id,
    ]);
  }
  for (const row of groupRows) {
    groupIds.set(row.video_id, [
      ...(groupIds.get(row.video_id) ?? []),
      row.group_id,
    ]);
  }
  return { categoryIds, groupIds };
}

export function serializeVideo(
  video: Video,
  assignments: Awaited<ReturnType<typeof getVideoAssignments>>,
) {
  return toAdminVideo(
    video,
    assignments.categoryIds.get(video.id) ?? [],
    assignments.groupIds.get(video.id) ?? [],
  );
}

export async function assertCategoriesExist(ids: number[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(inArray(categoriesTable.id, ids));
  if (rows.length !== new Set(ids).size) {
    throw badRequest("One or more categoryIds do not exist");
  }
}

export async function assertGroupsExist(ids: number[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(inArray(groupsTable.id, ids));
  if (rows.length !== new Set(ids).size) {
    throw badRequest("One or more groupIds do not exist");
  }
}

export async function replaceVideoAssignments(
  videoId: number,
  categoryIds: number[] | undefined,
  groupIds: number[] | undefined,
) {
  if (categoryIds !== undefined) {
    await assertCategoriesExist(categoryIds);
    await db
      .delete(videoCategoriesTable)
      .where(eq(videoCategoriesTable.video_id, videoId));
    if (categoryIds.length > 0) {
      await db.insert(videoCategoriesTable).values(
        [...new Set(categoryIds)].map((category_id) => ({
          video_id: videoId,
          category_id,
        })),
      );
    }
  }
  if (groupIds !== undefined) {
    await assertGroupsExist(groupIds);
    await db
      .delete(videoGroupsTable)
      .where(eq(videoGroupsTable.video_id, videoId));
    if (groupIds.length > 0) {
      await db.insert(videoGroupsTable).values(
        [...new Set(groupIds)].map((group_id) => ({
          video_id: videoId,
          group_id,
        })),
      );
    }
  }
}

export function assignmentFilters(
  groupId?: number,
  categoryId?: number,
) {
  const conditions = [];
  if (groupId !== undefined) {
    conditions.push(
      inArray(
        videosTable.id,
        db
          .select({ id: videoGroupsTable.video_id })
          .from(videoGroupsTable)
          .where(eq(videoGroupsTable.group_id, groupId)),
      ),
    );
  }
  if (categoryId !== undefined) {
    conditions.push(
      inArray(
        videosTable.id,
        db
          .select({ id: videoCategoriesTable.video_id })
          .from(videoCategoriesTable)
          .where(eq(videoCategoriesTable.category_id, categoryId)),
      ),
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
