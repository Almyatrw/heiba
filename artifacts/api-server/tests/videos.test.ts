import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  categoriesTable,
  db,
  videoGroupsTable,
  videosTable,
} from "@workspace/db";
import {
  api,
  authAs,
  createGroup,
  createUser,
  createVideo,
  loginUser,
  resetDatabase,
} from "./helpers";

const TEST_STORAGE_DIR = path.resolve(import.meta.dirname, "../.test-storage");
const MP4_BYTES = Buffer.from(
  "000000206674797069736f6d0000020069736f6d69736f32", // ftyp header-ish
  "hex",
);

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

async function createCategory(name: string) {
  const [category] = await db
    .insert(categoriesTable)
    .values({ name })
    .returning();
  return category;
}

async function uploadFile(
  token: string,
  videoId: number,
  contentType = "video/mp4",
) {
  return api()
    .post(`/api/videos/${videoId}/file`)
    .set(authAs(token))
    .attach("file", MP4_BYTES, {
      filename: "clip.mp4",
      contentType,
    });
}

describe("video metadata management", () => {
  it("creates a video in PROCESSING status with assignments", async () => {
    const owner = await loginAs("OWNER");
    const category = await createCategory("Training");
    const group = await createGroup(owner.user.id);

    const res = await api()
      .post("/api/videos")
      .set(authAs(owner.token))
      .send({
        title: "Onboarding",
        description: "Intro",
        tags: ["intro", "onboarding"],
        categoryIds: [category.id],
        groupIds: [group.id],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PROCESSING");
    expect(res.body.tags).toEqual(["intro", "onboarding"]);
    expect(res.body.categoryIds).toEqual([category.id]);
    expect(res.body.groupIds).toEqual([group.id]);
    expect(res.body.mimeType).toBeNull();
    expect(res.body.sizeBytes).toBeNull();
    // Internal storage location must never be exposed
    expect(res.body.storageKey).toBeUndefined();
    expect(res.body.storage_key).toBeUndefined();
  });

  it("rejects invalid titles and unknown category/group references", async () => {
    const owner = await loginAs("OWNER");
    const bad = await api()
      .post("/api/videos")
      .set(authAs(owner.token))
      .send({ title: "" });
    expect(bad.status).toBe(400);

    const unknownRefs = await api()
      .post("/api/videos")
      .set(authAs(owner.token))
      .send({ title: "x", categoryIds: [4242], groupIds: [999] });
    expect(unknownRefs.status).toBe(400);
  });

  it("forbids MEMBER and GROUP_MANAGER from the management API", async () => {
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");
    for (const { token } of [member, manager]) {
      expect((await api().get("/api/videos").set(authAs(token))).status).toBe(
        403,
      );
      expect(
        (await api().post("/api/videos").set(authAs(token)).send({ title: "x" }))
          .status,
      ).toBe(403);
    }
  });

  it("updates metadata and re-assigns categories/groups", async () => {
    const owner = await loginAs("OWNER");
    const category = await createCategory("C1");
    const group = await createGroup(owner.user.id);
    const video = await createVideo(owner.user.id, { title: "Old" });

    const res = await api()
      .patch(`/api/videos/${video.id}`)
      .set(authAs(owner.token))
      .send({
        title: "New title",
        description: null,
        tags: ["updated"],
        categoryIds: [category.id],
        groupIds: [group.id],
      });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New title");
    expect(res.body.description).toBeNull();
    expect(res.body.categoryIds).toEqual([category.id]);
    expect(res.body.groupIds).toEqual([group.id]);

    const joins = await db
      .select()
      .from(videoGroupsTable)
      .where(eq(videoGroupsTable.video_id, video.id));
    expect(joins).toHaveLength(1);
    expect(joins[0].group_id).toBe(group.id);
  });

  it("lists with status, group and category filters", async () => {
    const owner = await loginAs("OWNER");
    const category = await createCategory("Cat");
    const group = await createGroup(owner.user.id);
    await createVideo(owner.user.id, { status: "PROCESSING" });
    const v2 = await createVideo(owner.user.id, { status: "APPROVED" });
    await createVideo(owner.user.id, { status: "APPROVED" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: v2.id, group_id: group.id });

    const all = await api().get("/api/videos").set(authAs(owner.token));
    expect(all.body.total).toBe(3);

    const approved = await api()
      .get("/api/videos?status=APPROVED")
      .set(authAs(owner.token));
    expect(approved.body.total).toBe(2);

    const byGroup = await api()
      .get(`/api/videos?groupId=${group.id}`)
      .set(authAs(owner.token));
    expect(byGroup.body.total).toBe(1);
    expect(byGroup.body.videos[0].id).toBe(v2.id);

    const byCategory = await api()
      .get(`/api/videos?categoryId=${category.id}`)
      .set(authAs(owner.token));
    expect(byCategory.body.total).toBe(0);
  });
});

describe("video upload", () => {
  it("stores the file outside PostgreSQL and moves to PENDING_REVIEW", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);

    const res = await uploadFile(owner.token, video.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.mimeType).toBe("video/mp4");
    expect(res.body.sizeBytes).toBe(MP4_BYTES.length);
    expect(res.body.originalFileName).toBe("clip.mp4");
    expect(res.body.storageProvider).toBe("local");

    // Binary lives in the storage directory, keyed server-side
    const [row] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    expect(row.storage_key).toMatch(/^videos\/\d+\/[0-9a-f]{16}\.mp4$/);
    const stored = await readFile(path.join(TEST_STORAGE_DIR, row.storage_key!));
    expect(stored.equals(MP4_BYTES)).toBe(true);
    expect(row.pending_review_at).not.toBeNull();
  });

  it("replaces the stored object on re-upload and requires re-review", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id, { status: "APPROVED" });

    await uploadFile(owner.token, video.id);
    const [first] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    const firstKey = first.storage_key!;

    const res = await uploadFile(owner.token, video.id);
    expect(res.status).toBe(200);
    const [second] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    expect(second.storage_key).not.toBe(firstKey);
    expect(second.status).toBe("PENDING_REVIEW");
    expect(second.approved_at).toBeNull();

    // The replaced object is gone from storage
    await expect(
      access(path.join(TEST_STORAGE_DIR, firstKey)),
    ).rejects.toThrow();
    await expect(
      access(path.join(TEST_STORAGE_DIR, second.storage_key!)),
    ).resolves.toBeUndefined();
  });

  it("rejects unsupported media types", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await uploadFile(owner.token, video.id, "image/png");
    expect(res.status).toBe(400);

    const [row] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    expect(row.storage_key).toBeNull();
    expect(row.status).toBe("PROCESSING");
  });

  it("rejects a request without a file field", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/file`)
      .set(authAs(owner.token))
      .field("notfile", "hello");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown videos and 403 for members", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const video = await createVideo(owner.user.id);

    expect((await uploadFile(owner.token, 999999)).status).toBe(404);
    expect((await uploadFile(member.token, video.id)).status).toBe(403);
  });
});

describe("video deletion", () => {
  it("removes the row and the stored object", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    await uploadFile(owner.token, video.id);
    const [row] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));

    const res = await api()
      .delete(`/api/videos/${video.id}`)
      .set(authAs(owner.token));
    expect(res.status).toBe(204);
    await expect(
      access(path.join(TEST_STORAGE_DIR, row.storage_key!)),
    ).rejects.toThrow();
    expect(
      (await db.select().from(videosTable).where(eq(videosTable.id, video.id)))
        .length,
    ).toBe(0);
  });
});
