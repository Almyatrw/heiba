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

// Polls import-status until the background job reaches a terminal state.
async function waitForImport(token: string, videoId: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const res = await api()
      .get(`/api/videos/${videoId}/import-status`)
      .set(authAs(token));
    expect(res.status).toBe(200);
    if (res.body.state === "COMPLETED" || res.body.state === "FAILED") {
      return res.body as {
        state: string;
        error: string | null;
        videoStatus: string;
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("import did not finish in time");
}

describe("URL import", () => {
  it("imports a direct video URL into PENDING_REVIEW with stored bytes", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);

    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/video.mp4` });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PROCESSING");

    const status = await waitForImport(owner.token, video.id);
    expect(status.state).toBe("COMPLETED");

    const videoRes = await api()
      .get(`/api/videos/${video.id}`)
      .set(authAs(owner.token));
    expect(videoRes.body.status).toBe("PENDING_REVIEW");
    expect(videoRes.body.sizeBytes).toBe(MP4_BYTES.length);
    expect(videoRes.body.mimeType).toBe("video/mp4");
  });

  it("follows redirects to direct video URLs", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/redirect.mp4` });
    expect(res.status).toBe(202);
    const status = await waitForImport(owner.token, video.id);
    expect(status.state).toBe("COMPLETED");
    expect(status.videoStatus).toBe("PENDING_REVIEW");
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

  it("rejects non-video content (background failure is surfaced)", async () => {
    const owner = await loginAs("OWNER");
    const video = await createVideo(owner.user.id);
    const res = await api()
      .post(`/api/videos/${video.id}/import`)
      .set(authAs(owner.token))
      .send({ url: `${baseUrl}/page.html` });
    expect(res.status).toBe(202);
    const status = await waitForImport(owner.token, video.id);
    expect(status.state).toBe("FAILED");
    expect(status.videoStatus).toBe("FAILED");
    expect(status.error).toMatch(/supported video file/);
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
    expect(dead.status).toBe(202);
    const status = await waitForImport(owner.token, video.id);
    expect(status.state).toBe("FAILED");
    expect(status.videoStatus).toBe("FAILED");
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
      expect(res.status).toBe(202);
      const status = await waitForImport(owner.token, video.id);
      expect(status.state).toBe("FAILED");
      expect(status.error).toMatch(/limit/);
    } finally {
      if (previous === undefined) delete process.env.VIDEO_MAX_BYTES;
      else process.env.VIDEO_MAX_BYTES = previous;
    }
  });

  it("blocks private/reserved network targets (SSRF guard)", async () => {
    const previous = process.env.HEIBA_IMPORT_ALLOW_PRIVATE_NET;
    delete process.env.HEIBA_IMPORT_ALLOW_PRIVATE_NET;
    try {
      const owner = await loginAs("OWNER");
      const video = await createVideo(owner.user.id);
      for (const url of [
        `${baseUrl}/video.mp4`, // 127.0.0.1 stub origin is blocked when the guard is on
        "http://192.168.1.10/video.mp4",
        "http://169.254.169.254/latest/meta-data",
      ]) {
        const res = await api()
          .post(`/api/videos/${video.id}/import`)
          .set(authAs(owner.token))
          .send({ url });
        expect(res.status).toBe(202); // guard runs in the background job
        const status = await waitForImport(owner.token, video.id);
        expect(status.state).toBe("FAILED");
        expect(status.error).toMatch(/private|reserved|routable/);
      }
    } finally {
      if (previous === undefined) delete process.env.HEIBA_IMPORT_ALLOW_PRIVATE_NET;
      else process.env.HEIBA_IMPORT_ALLOW_PRIVATE_NET = previous;
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
