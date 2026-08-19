import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, videoUploadsTable } from "@workspace/db";
import {
  api,
  authAs,
  createUser,
  createVideo,
  loginUser,
  resetDatabase,
} from "./helpers";
import {
  setVideoStorageForTests,
  type CompletedPart,
  type PreparedDirectUpload,
  type VideoStorage,
} from "../src/lib/storage";

// In-memory storage that implements the direct-upload protocol — a stand-in
// for R2, which cannot be reached from the test environment. The ROUTES under
// test are the real code path; only the vendor SDK calls are replaced.
class MemoryDirectStorage implements VideoStorage {
  readonly provider = "memory-direct";
  objects = new Map<string, Buffer>();
  aborted: string[] = [];

  async save(key: string, stream: Readable): Promise<{ sizeBytes: number }> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buf = Buffer.concat(chunks);
    this.objects.set(key, buf);
    return { sizeBytes: buf.length };
  }

  async openReadStream(key: string, range?: { start: number; end: number }) {
    const buf = this.objects.get(key);
    if (!buf) throw new Error(`missing ${key}`);
    const slice = range ? buf.subarray(range.start, range.end + 1) : buf;
    return Readable.from(slice);
  }

  async stat(key: string) {
    const buf = this.objects.get(key);
    return buf ? { sizeBytes: buf.length } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async exists(key: string) {
    return this.objects.has(key);
  }

  supportsDirectUpload() {
    return true;
  }

  async prepareDirectUpload(key: string): Promise<PreparedDirectUpload> {
    return {
      mode: "multipart",
      providerUploadId: `mpu-${key}`,
      parts: [
        { partNumber: 1, url: `https://r2.invalid/${key}?part=1` },
        { partNumber: 2, url: `https://r2.invalid/${key}?part=2` },
      ],
    };
  }

  async completeDirectUpload(key: string, _uploadId: string | null, _parts: CompletedPart[]) {
    this.objects.set(key, Buffer.from("direct-uploaded-bytes"));
    return { sizeBytes: 21 };
  }

  async abortDirectUpload(key: string, providerUploadId: string) {
    this.aborted.push(`${key}#${providerUploadId}`);
  }
}

let memory: MemoryDirectStorage;

beforeEach(async () => {
  await resetDatabase();
  memory = new MemoryDirectStorage();
  setVideoStorageForTests(memory);
});

afterEach(() => {
  setVideoStorageForTests(null);
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

describe("direct browser-to-storage uploads", () => {
  it("reports capabilities for the active provider", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .get(`/api/videos/${video.id}/upload-capabilities`)
      .set(authAs(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.directUploadSupported).toBe(true);
    expect(res.body.maxBytes).toBeGreaterThan(0);
  });

  it("creates a tracked multipart job with presigned parts", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 100_000_000, mimeType: "video/mp4", fileName: "a.mp4" });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("multipart");
    expect(res.body.parts.length).toBe(2);

    const jobs = await db
      .select()
      .from(videoUploadsTable)
      .where(eq(videoUploadsTable.video_id, video.id));
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("INITIATED");
    expect(jobs[0].provider_upload_id).toBeTruthy();
  });

  it("completes a job: video enters PENDING_REVIEW and streams", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const created = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    const uploadId = created.body.uploadId;

    const done = await api()
      .post(`/api/videos/${video.id}/direct-upload/${uploadId}/complete`)
      .set(authAs(owner.token))
      .send({
        parts: [
          { partNumber: 1, etag: '"e1"' },
          { partNumber: 2, etag: '"e2"' },
        ],
      });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("PENDING_REVIEW");
    expect(done.body.sizeBytes).toBe(21);

    const [job] = await db
      .select()
      .from(videoUploadsTable)
      .where(eq(videoUploadsTable.id, uploadId));
    expect(job.status).toBe("COMPLETED");

    // Idempotency guard: a completed job cannot be completed again
    const again = await api()
      .post(`/api/videos/${video.id}/direct-upload/${uploadId}/complete`)
      .set(authAs(owner.token))
      .send({ parts: [] });
    expect(again.status).toBe(400);
  });

  it("aborts a job at the provider and blocks completion afterwards", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const created = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    const uploadId = created.body.uploadId;

    const aborted = await api()
      .post(`/api/videos/${video.id}/direct-upload/${uploadId}/abort`)
      .set(authAs(owner.token));
    expect(aborted.status).toBe(204);
    expect(memory.aborted.length).toBe(1);

    const done = await api()
      .post(`/api/videos/${video.id}/direct-upload/${uploadId}/complete`)
      .set(authAs(owner.token))
      .send({ parts: [] });
    expect(done.status).toBe(400);
  });

  it("rejects jobs belonging to a different video (IDOR)", async () => {
    const owner = await loginAs("OWNER");
    const videoA = await createVideo(owner.user.id);
    const videoB = await createVideo(owner.user.id);
    const created = await api()
      .post(`/api/videos/${videoA.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    const uploadId = created.body.uploadId;

    const wrongVideo = await api()
      .post(`/api/videos/${videoB.id}/direct-upload/${uploadId}/complete`)
      .set(authAs(owner.token))
      .send({ parts: [] });
    expect(wrongVideo.status).toBe(400);
  });

  it("rejects expired jobs", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const created = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    const uploadId = created.body.uploadId;

    await db
      .update(videoUploadsTable)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(videoUploadsTable.id, uploadId));

    const done = await api()
      .post(`/api/videos/${video.id}/direct-upload/${uploadId}/complete`)
      .set(authAs(owner.token))
      .send({ parts: [] });
    expect(done.status).toBe(400);
    expect(done.body.message).toMatch(/expired/);
  });

  it("rejects oversized declarations and unsupported media types", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const tooBig = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 3 * 1024 * 1024 * 1024, mimeType: "video/mp4", fileName: "a.mp4" });
    expect(tooBig.status).toBe(413);

    const badType = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "application/exe", fileName: "a.exe" });
    expect(badType.status).toBe(400);
  });

  it("forbids MEMBER role from all direct-upload endpoints", async () => {
    const member = await loginAs("MEMBER");
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const created = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(member.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    expect(created.status).toBe(403);
    const caps = await api()
      .get(`/api/videos/${video.id}/upload-capabilities`)
      .set(authAs(member.token));
    expect(caps.status).toBe(403);
  });

  it("returns 400 for direct uploads on providers without presigning", async () => {
    setVideoStorageForTests({
      provider: "bare",
      save: async () => ({ sizeBytes: 0 }),
      openReadStream: async () => Readable.from([]),
      stat: async () => null,
      delete: async () => {},
      exists: async () => false,
    });
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const caps = await api()
      .get(`/api/videos/${video.id}/upload-capabilities`)
      .set(authAs(owner.token));
    expect(caps.body.directUploadSupported).toBe(false);
    const res = await api()
      .post(`/api/videos/${video.id}/direct-upload`)
      .set(authAs(owner.token))
      .send({ sizeBytes: 21, mimeType: "video/mp4", fileName: "a.mp4" });
    expect(res.status).toBe(400);
  });
});
