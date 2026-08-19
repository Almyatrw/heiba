import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  api,
  authAs,
  createUser,
  createVideo,
  loginUser,
  resetDatabase,
} from "./helpers";

const MP4_BYTES = Buffer.from(
  "000000206674797069736f6d0000020069736f6d69736f327661696f6d703432",
  "hex",
);

// A real HTTP server standing in for a remote origin. Routes:
//   /video.mp4          → video/mp4 bytes
//   /redirect.mp4       → 302 to /video.mp4
//   /notfound.mp4       → 404
//   /page.html          → text/html (not a video)
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/video.mp4") {
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": MP4_BYTES.length,
      });
      res.end(MP4_BYTES);
      return;
    }
    if (req.url === "/redirect.mp4") {
      res.writeHead(302, { location: "/video.mp4" });
      res.end();
      return;
    }
    if (req.url === "/page.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

describe("URL import", () => {
  it("imports a direct video URL into PENDING_REVIEW with stored bytes", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);

    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/video.mp4` });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.sizeBytes).toBe(MP4_BYTES.length);
    expect(res.body.mimeType).toBe("video/mp4");
  });

  it("follows redirects to direct video URLs", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/redirect.mp4` });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_REVIEW");
  });

  it("rejects YouTube URLs (disabled by default)", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/YouTube import is disabled/);
  });

  it("rejects social platform URLs (stubbed providers)", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    for (const url of [
      "https://x.com/user/status/1",
      "https://www.tiktok.com/@user/video/1",
      "https://www.instagram.com/reel/abc/",
    ]) {
      const res = await api()
        .post(`/api/videos/${video.id}/import`)
        .set(authAs(owner.token))
        .send({ url });
      expect(res.status).toBe(400);
    }
  });

  it("rejects non-video content", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/page.html` });
    expect(res.status).toBe(400);
  });

  it("rejects unreachable origins and non-http(s) schemes", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const badScheme = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: "ftp://example.com/video.mp4" });
    expect(badScheme.status).toBe(400);

    const dead = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: "http://127.0.0.1:1/video.mp4" });
    expect(dead.status).toBe(400);
  });

  it("rejects files larger than the configured limit (declared length)", async () => {
    const previous = process.env.VIDEO_MAX_BYTES;
    process.env.VIDEO_MAX_BYTES = "8";
    try {
      const owner = await loginAs("OWNER");
      const video = await createVideo(owner.user.id);
      const res = await api()
        .post(`/api/videos/${video.id}/import`)
        .set(authAs(owner.token))
        .send({ url: `${baseUrl}/video.mp4` });
      expect(res.status).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.VIDEO_MAX_BYTES;
      else process.env.VIDEO_MAX_BYTES = previous;
    }
  });

  it("rejects MEMBER role", async () => {
    const member = await loginAs("MEMBER");
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(member.token))
      .send({ url: `${baseUrl}/video.mp4` });
    expect(res.status).toBe(403);
  });
});
