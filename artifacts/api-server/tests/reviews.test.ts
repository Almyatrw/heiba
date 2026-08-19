import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, videoReviewsTable, videosTable } from "@workspace/db";
import {
  api,
  authAs,
  createUser,
  createVideo,
  loginUser,
  resetDatabase,
} from "./helpers";

const MP4_BYTES = Buffer.from("000000206674797069736f6d", "hex");

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

async function uploadTo(token: string, videoId: number) {
  const res = await api()
    .post(`/api/videos/${videoId}/file`)
    .set(authAs(token))
    .attach("file", MP4_BYTES, { filename: "clip.mp4", contentType: "video/mp4" });
  expect(res.status).toBe(200);
}

describe("pending review queue", () => {
  it("lists only PENDING_REVIEW videos, oldest first", async () => {
    const owner = await loginAs("OWNER");
    const v1 = await createVideo(owner.user.id);
    const v2 = await createVideo(owner.user.id);
    await createVideo(owner.user.id, { status: "PROCESSING" });

    // Nothing pending before uploads
    let res = await api()
      .get("/api/reviews/pending")
      .set(authAs(owner.token));
    expect(res.body.total).toBe(0);

    await uploadTo(owner.token, v1.id);
    await uploadTo(owner.token, v2.id);

    res = await api().get("/api/reviews/pending").set(authAs(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.videos.map((v: { id: number }) => v.id)).toEqual([
      v1.id,
      v2.id,
    ]);
  });

  it("is forbidden for MEMBER and GROUP_MANAGER", async () => {
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");
    for (const { token } of [member, manager]) {
      const res = await api()
        .get("/api/reviews/pending")
        .set(authAs(token));
      expect(res.status).toBe(403);
    }
  });
});

describe("manual review decisions", () => {
  it("approving sets APPROVED and records the reviewer", async () => {
    const owner = await loginAs("OWNER");
    const admin = await loginAs("ADMIN");
    const video = await createVideo(owner.user.id);
    await uploadTo(owner.token, video.id);

    const res = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(admin.token))
      .send({ action: "APPROVED", notes: "looks good" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");

    const reviews = await db
      .select()
      .from(videoReviewsTable)
      .where(eq(videoReviewsTable.video_id, video.id));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].action).toBe("APPROVED");
    expect(reviews[0].reviewer_id).toBe(admin.user.id);
    expect(reviews[0].notes).toBe("looks good");

    const [row] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    expect(row.status).toBe("APPROVED");
    expect(row.approved_at).not.toBeNull();
  });

  it("rejecting sets REJECTED; rejected videos can be re-reviewed", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    await uploadTo(owner.token, video.id);

    const reject = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "REJECTED", notes: "not suitable" });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("REJECTED");

    // No longer in the pending queue
    const pending = await api()
      .get("/api/reviews/pending")
      .set(authAs(owner.token));
    expect(pending.body.total).toBe(0);

    const approve = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "APPROVED" });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("APPROVED");

    const history = await api()
      .get(`/api/videos/${video.id}/reviews`)
      .set(authAs(owner.token));
    expect(history.body.reviews).toHaveLength(2);
    expect(history.body.reviews[0].action).toBe("APPROVED"); // newest first
    expect(history.body.reviews[1].action).toBe("REJECTED");
  });

  it("approved videos can be taken down (APPROVED -> REJECTED)", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id, {
      status: "APPROVED",
      storageKey: "videos/x/fake.mp4",
    });
    const res = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "REJECTED", notes: "copyright claim" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
  });

  it("refuses to review a video without an uploaded file (409)", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id); // PROCESSING, no file

    const res = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "APPROVED" });
    expect(res.status).toBe(409);

    const [row] = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, video.id));
    expect(row.status).toBe("PROCESSING");
  });

  it("validates the review action", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    await uploadTo(owner.token, video.id);
    const res = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "MAYBE" });
    expect(res.status).toBe(400);
  });

  it("is forbidden for MEMBER and GROUP_MANAGER and unknown videos 404", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");
    const video = await createVideo(owner.user.id);
    await uploadTo(owner.token, video.id);

    for (const { token } of [member, manager]) {
      const res = await api()
        .post(`/api/videos/${video.id}/review`)
        .set(authAs(token))
        .send({ action: "APPROVED" });
      expect(res.status).toBe(403);
    }

    const missing = await api()
      .post("/api/videos/999999/review")
      .set(authAs(owner.token))
      .send({ action: "APPROVED" });
    expect(missing.status).toBe(404);
  });
});
