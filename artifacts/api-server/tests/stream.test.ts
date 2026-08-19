import { beforeEach, describe, expect, it } from "vitest";
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

const MP4_BYTES = Buffer.from(
  "000000206674797069736f6d0000020069736f6d69736f327661696f6d703432",
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

// Creates a video, uploads real bytes via the API, assigns groups, and
// optionally approves it.
async function uploadedVideo(
  ownerToken: string,
  ownerId: number,
  options: { approve?: boolean; groupIds?: number[] } = {},
) {
  const video = await createVideo(ownerId, { title: "stream-me" });
  const up = await api()
    .post(`/api/videos/${video.id}/file`)
    .set(authAs(ownerToken))
    .attach("file", MP4_BYTES, { filename: "clip.mp4", contentType: "video/mp4" });
  expect(up.status).toBe(200);
  if (options.groupIds?.length) {
    const patch = await api()
      .patch(`/api/videos/${video.id}`)
      .set(authAs(ownerToken))
      .send({ groupIds: options.groupIds });
    expect(patch.status).toBe(200);
  }
  if (options.approve) {
    const review = await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(ownerToken))
      .send({ action: "APPROVED" });
    expect(review.status).toBe(200);
  }
  return video;
}

describe("secure streaming", () => {
  it("streams the full body with correct headers", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);
    const video = await uploadedVideo(owner.token, owner.user.id, {
      approve: true,
      groupIds: [group.id],
    });

    const res = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(member.token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe(String(MP4_BYTES.length));
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename="video-${video.id}"`,
    );
    // Path hiding: the storage key must not appear anywhere
    expect(JSON.stringify(res.headers)).not.toMatch(/videos\/\d+\/[0-9a-f]{16}/);
    expect((res.body as Buffer).equals(MP4_BYTES)).toBe(true);
  });

  it("supports byte ranges (206) for seeking", async () => {
    const owner = await loginAs("OWNER");
    const video = await uploadedVideo(owner.token, owner.user.id, {
      approve: true,
    });

    const res = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(owner.token))
      .set("Range", "bytes=4-11")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(
      `bytes 4-11/${MP4_BYTES.length}`,
    );
    expect(res.headers["content-length"]).toBe("8");
    expect((res.body as Buffer).equals(MP4_BYTES.subarray(4, 12))).toBe(true);
  });

  it("supports suffix ranges and rejects invalid ranges with 416", async () => {
    const owner = await loginAs("OWNER");
    const video = await uploadedVideo(owner.token, owner.user.id, {
      approve: true,
    });

    const suffix = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(owner.token))
      .set("Range", "bytes=-4")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(suffix.status).toBe(206);
    expect((suffix.body as Buffer).equals(MP4_BYTES.subarray(-4))).toBe(true);

    const bad = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(owner.token))
      .set("Range", `bytes=${MP4_BYTES.length + 10}-`);
    expect(bad.status).toBe(416);
    expect(bad.headers["content-range"]).toBe(`bytes */${MP4_BYTES.length}`);

    const malformed = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(owner.token))
      .set("Range", "bananas");
    expect(malformed.status).toBe(416);
  });

  it("hides unapproved videos from members but lets admins preview them", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);

    // Not approved yet (PENDING_REVIEW after upload)
    const video = await uploadedVideo(owner.token, owner.user.id, {
      groupIds: [group.id],
    });

    const memberRes = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(member.token));
    expect(memberRes.status).toBe(404);

    // Admins must be able to watch the video to review it
    const ownerRes = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(owner.token));
    expect(ownerRes.status).toBe(200);
  });

  it("denies members outside the assigned groups and the unauthenticated", async () => {
    const owner = await loginAs("OWNER");
    const outsider = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    const video = await uploadedVideo(owner.token, owner.user.id, {
      approve: true,
      groupIds: [group.id],
    });

    const outsiderRes = await api()
      .get(`/api/stream/${video.id}`)
      .set(authAs(outsider.token));
    expect(outsiderRes.status).toBe(404);

    const anonRes = await api().get(`/api/stream/${video.id}`);
    expect(anonRes.status).toBe(401);

    const missingRes = await api()
      .get("/api/stream/424242")
      .set(authAs(owner.token));
    expect(missingRes.status).toBe(404);
  });

  it("rejected/taken-down videos stop streaming for members immediately", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id);
    const video = await uploadedVideo(owner.token, owner.user.id, {
      approve: true,
      groupIds: [group.id],
    });

    expect(
      (await api().get(`/api/stream/${video.id}`).set(authAs(member.token)))
        .status,
    ).toBe(200);

    await api()
      .post(`/api/videos/${video.id}/review`)
      .set(authAs(owner.token))
      .send({ action: "REJECTED", notes: "takedown" });

    expect(
      (await api().get(`/api/stream/${video.id}`).set(authAs(member.token)))
        .status,
    ).toBe(404);
  });
});
