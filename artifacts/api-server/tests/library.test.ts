import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  addMember,
  api,
  authAs,
  createGroup,
  createUser,
  createVideo,
  loginUser,
  resetDatabase,
} from "./helpers";
import {
  categoriesTable,
  db,
  videoCategoriesTable,
  videoGroupsTable,
  videosTable,
} from "@workspace/db";

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

describe("member library visibility", () => {
  it("members see only APPROVED videos shared with their groups", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    const otherGroup = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);

    const visible = await createVideo(owner.user.id, { status: "APPROVED" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: visible.id, group_id: group.id });

    const wrongGroup = await createVideo(owner.user.id, { status: "APPROVED" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: wrongGroup.id, group_id: otherGroup.id });

    const pending = await createVideo(owner.user.id, { status: "PENDING_REVIEW" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: pending.id, group_id: group.id });

    const rejected = await createVideo(owner.user.id, { status: "REJECTED" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: rejected.id, group_id: group.id });

    const res = await api().get("/api/library/videos").set(authAs(member.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.videos[0].id).toBe(visible.id);
    expect(JSON.stringify(res.body)).not.toContain("storage_key");
  });

  it("members with no groups see an empty library", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    await createVideo(owner.user.id, { status: "APPROVED" });

    const res = await api().get("/api/library/videos").set(authAs(member.token));
    expect(res.body.total).toBe(0);
    expect(res.body.videos).toEqual([]);
  });

  it("videos without group assignments are private to OWNER/ADMIN", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);
    await createVideo(owner.user.id, { status: "APPROVED" }); // no groups

    const memberRes = await api()
      .get("/api/library/videos")
      .set(authAs(member.token));
    expect(memberRes.body.total).toBe(0);

    const ownerRes = await api()
      .get("/api/library/videos")
      .set(authAs(owner.token));
    expect(ownerRes.body.total).toBe(1);
  });

  it("admins see all approved videos in the library but not unapproved ones", async () => {
    const owner = await loginAs("OWNER");
    const admin = await loginAs("ADMIN");
    await createVideo(owner.user.id, { status: "APPROVED" });
    await createVideo(owner.user.id, { status: "PENDING_REVIEW" });
    await createVideo(owner.user.id, { status: "REJECTED" });

    const res = await api().get("/api/library/videos").set(authAs(admin.token));
    expect(res.body.total).toBe(1);
  });

  it("supports search over title and description", async () => {
    const owner = await loginAs("OWNER");
    await createVideo(owner.user.id, {
      title: "Kubernetes deep dive",
      status: "APPROVED",
    });
    const other = await createVideo(owner.user.id, {
      title: "Cooking basics",
      status: "APPROVED",
    });
    await db
      .update(videosTable)
      .set({ description: "all about clusters" })
      .where(eq(videosTable.id, other.id));

    const byTitle = await api()
      .get("/api/library/videos?q=kubernetes")
      .set(authAs(owner.token));
    expect(byTitle.body.total).toBe(1);

    const byDescription = await api()
      .get("/api/library/videos?q=clusters")
      .set(authAs(owner.token));
    expect(byDescription.body.total).toBe(1);
    expect(byDescription.body.videos[0].id).toBe(other.id);

    const noMatch = await api()
      .get("/api/library/videos?q=zzz-no-match")
      .set(authAs(owner.token));
    expect(noMatch.body.total).toBe(0);
  });

  it("filters by category and group", async () => {
    const owner = await loginAs("OWNER");
    const group = await createGroup(owner.user.id);
    const [category] = await db
      .insert(categoriesTable)
      .values({ name: "Lecture" })
      .returning();

    const inBoth = await createVideo(owner.user.id, { status: "APPROVED" });
    await db.insert(videoGroupsTable).values({ video_id: inBoth.id, group_id: group.id });
    await db
      .insert(videoCategoriesTable)
      .values({ video_id: inBoth.id, category_id: category.id });
    await createVideo(owner.user.id, { status: "APPROVED" });

    const byCategory = await api()
      .get(`/api/library/videos?categoryId=${category.id}`)
      .set(authAs(owner.token));
    expect(byCategory.body.total).toBe(1);

    const byGroup = await api()
      .get(`/api/library/videos?groupId=${group.id}`)
      .set(authAs(owner.token));
    expect(byGroup.body.total).toBe(1);
  });

  it("video detail is 404 for hidden videos and 200 for visible ones", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);

    const visible = await createVideo(owner.user.id, { status: "APPROVED" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: visible.id, group_id: group.id });
    const hidden = await createVideo(owner.user.id, { status: "APPROVED" });
    const pending = await createVideo(owner.user.id, { status: "PENDING_REVIEW" });
    await db
      .insert(videoGroupsTable)
      .values({ video_id: pending.id, group_id: group.id });

    expect(
      (
        await api()
          .get(`/api/library/videos/${visible.id}`)
          .set(authAs(member.token))
      ).status,
    ).toBe(200);
    for (const v of [hidden, pending]) {
      expect(
        (
          await api()
            .get(`/api/library/videos/${v.id}`)
            .set(authAs(member.token))
        ).status,
      ).toBe(404);
    }
    expect(
      (await api().get(`/api/library/videos/${visible.id}`)).status,
    ).toBe(401);
  });
});
