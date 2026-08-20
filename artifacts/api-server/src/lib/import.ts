import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { badRequest } from "./errors";
import { getVideoStorage } from "./storage";
import { maxUploadBytes } from "./uploads";

// ── VideoImportProvider abstraction ────────────────────────────────────────
// Importing fetches a video from an external URL and stores it through the
// same VideoStorage boundary as uploads. Supported sources:
//   - direct video file URLs (mp4, webm, mkv, mov)
//   - X/Twitter post URLs   (HEIBA_ENABLE_X_IMPORT=true)
//   - YouTube URLs          (HEIBA_ENABLE_YOUTUBE_IMPORT=true)
// Platform providers resolve post URLs to the real media URL via yt-dlp and
// then stream the media through the same validated direct-fetch path. V1
// does not bypass DRM, authentication, paywalls, or any other technical
// protection — providers only work for publicly accessible content the
// operator has rights to.

export interface ImportedVideo {
  stream: Readable;
  fileName: string;
  mimeType: string;
  declaredSizeBytes: number | null;
}

export interface VideoImportProvider {
  readonly name: string;
  /** Does this provider claim responsibility for the URL? */
  matches(url: URL): boolean;
  /** Is the provider enabled for use? */
  isEnabled(): boolean;
  /** User-facing reason when disabled/unsupported. */
  disabledReason(): string | null;
  /** Open the remote object as a stream. Throws HttpError on failure. */
  fetch(url: URL): Promise<ImportedVideo>;
}

const IMPORT_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/quicktime": ".mov",
};

const IMPORT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

// ── SSRF guard ─────────────────────────────────────────────────────────────
// Imports fetch attacker-influenced URLs server-side. Block anything that
// resolves to loopback/link-local/private/multicast ranges so an import URL
// can never reach internal services or cloud metadata endpoints. Applied to
// every hop (initial URL + each redirect target). Can be disabled for
// private-network setups via HEIBA_IMPORT_ALLOW_PRIVATE_NET=true.
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast/reserved/broadcast
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fe80:") ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("::ffff:") && isPrivateIp(v.slice(7))
    );
  }
  return true; // unknown address family → refuse
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (process.env.HEIBA_IMPORT_ALLOW_PRIVATE_NET === "true") return;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw badRequest("URL host is not publicly routable");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw badRequest("URL points at a private or reserved network address");
    return;
  }
  let records: string[];
  try {
    records = (await dns.lookup(host, { all: true })).map((r) => r.address);
  } catch {
    throw badRequest("URL host could not be resolved");
  }
  if (records.length === 0 || records.some((ip) => isPrivateIp(ip))) {
    throw badRequest("URL resolves to a private or reserved network address");
  }
}

// ── Direct file URL provider ───────────────────────────────────────────────

class DirectUrlImportProvider implements VideoImportProvider {
  readonly name = "direct-url";

  matches(): boolean {
    return true; // fallback for any http(s) URL not claimed by a platform provider
  }

  isEnabled(): boolean {
    return true;
  }

  disabledReason(): null {
    return null;
  }

  async fetch(url: URL): Promise<ImportedVideo> {
    return fetchDirectVideoUrl(url);
  }
}

// Shared HTTP fetch used by the direct-URL provider and by platform
// providers (X, YouTube) once they have resolved the page URL to the real
// media URL. Handles redirects, timeouts, mime/size validation.
export async function fetchDirectVideoUrl(url: URL): Promise<ImportedVideo> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "heiba-importer/1.0" },
      });
    } catch (err) {
      clearTimeout(timer);
      throw badRequest(
        `Could not reach the video URL (${err instanceof Error ? err.message : "network error"})`,
      );
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw badRequest("Redirect without a Location header");
      const next = new URL(location, current);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw badRequest(`Refusing redirect to ${next.protocol} URL`);
      }
      await assertPublicUrl(next);
      current = next;
      continue;
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw badRequest(`Remote server responded with HTTP ${response.status}`);
    }

    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!IMPORT_MIME_EXTENSIONS[mimeType]) {
      await response.body.cancel().catch(() => {});
      throw badRequest(
        `URL does not point to a supported video file (got "${mimeType || "unknown"}")`,
      );
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxUploadBytes()) {
      await response.body.cancel().catch(() => {});
      throw badRequest(
        `Remote file exceeds the ${maxUploadBytes()}-byte limit`,
      );
    }

    const pathName = current.pathname.split("/").pop() ?? "video";
    return {
      stream: Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      fileName: decodeURIComponent(pathName) || "video",
      mimeType,
      declaredSizeBytes: Number.isFinite(declaredSize) ? declaredSize : null,
    };
  }
  throw badRequest("Too many redirects");
}

// ── Platform providers (media URLs resolved via yt-dlp) ────────────────────
// A platform/post URL (x.com/.../status/…, youtube.com/watch?v=…) is NOT a
// direct video file. yt-dlp resolves the post URL to the real media URL;
// the media itself is then streamed through the same direct-fetch helper as
// plain file URLs, so mime/size/redirect validation stays in one place.

const YTDLP_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

function resolveYtdlpBinary(): string {
  return process.env.YTDLP_PATH?.trim() || "yt-dlp";
}

// Downloads the post URL's media with yt-dlp into a temp file, preferring a
// single muxed mp4; falls back to merging best video+audio with ffmpeg when
// no muxed format exists (modern YouTube). The caller reads the file as a
// stream and it is deleted once the stream closes. This handles HLS and
// split DASH streams that plain HTTP fetching cannot.
async function downloadPlatformMedia(
  postUrl: URL,
  providerName: string,
  cookiesFile?: string,
): Promise<{ filePath: string; sizeBytes: number }> {
  const filePath = path.join(
    tmpdir(),
    `heiba-import-${randomBytes(6).toString("hex")}.mp4`,
  );
  const limit = maxUploadBytes();
  const cookieArgs = cookiesFile ? ["--cookies", cookiesFile] : [];
  await new Promise<void>((resolve, reject) => {
    execFile(
      resolveYtdlpBinary(),
      [
        "--no-playlist",
        "--no-warnings",
        "--max-filesize",
        String(limit),
        "--merge-output-format",
        "mp4",
        ...cookieArgs,
        "-f",
        "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestvideo+bestaudio/best",
        "-o",
        filePath,
        postUrl.toString(),
      ],
      { timeout: YTDLP_DOWNLOAD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message)
            .split("\n")
            .filter(Boolean)
            .slice(-2)
            .join(" ");
          reject(
            badRequest(
              `${providerName} could not download a video from this URL: ${detail.slice(0, 300)}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });

  const info = await stat(filePath).catch(() => null);
  if (!info || info.size === 0) {
    await unlink(filePath).catch(() => {});
    throw badRequest(`${providerName} produced no downloadable video data`);
  }
  if (info.size > limit) {
    await unlink(filePath).catch(() => {});
    throw badRequest(`Downloaded video exceeds the ${limit}-byte limit`);
  }
  return { filePath, sizeBytes: info.size };
}

abstract class YtDlpImportProvider implements VideoImportProvider {
  abstract readonly name: string;
  abstract readonly domains: string[];
  abstract readonly enableEnvVar: string;

  // Providers whose platform blocks unauthenticated extraction from
  // datacenter IPs (X) can be given a Netscape cookies.txt file on the
  // server (path from env, readable only by the app user, never logged).
  cookiesEnvVar(): string | null {
    return null;
  }

  async cookiesFile(): Promise<string | undefined> {
    const envVar = this.cookiesEnvVar();
    if (!envVar) return undefined;
    const file = process.env[envVar]?.trim();
    if (!file) return undefined;
    await access(file);
    return file;
  }

  matches(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return this.domains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  isEnabled(): boolean {
    return process.env[this.enableEnvVar] === "true";
  }

  disabledReason(): string {
    return `${this.name} import is disabled. Set ${this.enableEnvVar}=true on the server to enable it, and only for content the operator has rights to.`;
  }

  async fetch(url: URL): Promise<ImportedVideo> {
    const { filePath, sizeBytes } = await downloadPlatformMedia(
      url,
      this.name,
      await this.cookiesFile(),
    );
    const stream = createReadStream(filePath);
    // The temp file is scratch space only — remove it as soon as the
    // pipeline is done with it (success or failure).
    const cleanup = () => void unlink(filePath).catch(() => {});
    stream.on("close", cleanup);
    stream.on("error", cleanup);
    return {
      stream,
      fileName: `${this.name.toLowerCase()}-import.mp4`,
      mimeType: "video/mp4",
      declaredSizeBytes: sizeBytes,
    };
  }
}

class YouTubeImportProvider extends YtDlpImportProvider {
  readonly name = "YouTube";
  readonly domains = ["youtube.com", "youtu.be", "m.youtube.com"];
  readonly enableEnvVar = "HEIBA_ENABLE_YOUTUBE_IMPORT";
}

class XImportProvider extends YtDlpImportProvider {
  readonly name = "X";
  readonly domains = ["x.com", "twitter.com"];
  readonly enableEnvVar = "HEIBA_ENABLE_X_IMPORT";

  // X blocks guest extraction from most datacenter IPs; a logged-in
  // session via a cookies.txt file on the server restores access.
  cookiesEnvVar(): string {
    return "HEIBA_X_COOKIES_FILE";
  }
}

// Platforms recognised so users get a clear error instead of a silent
// fallback onto the direct-URL path.
class SocialStubProvider implements VideoImportProvider {
  constructor(
    readonly name: string,
    readonly domains: string[],
  ) {}

  matches(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return this.domains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  isEnabled(): boolean {
    return false;
  }

  disabledReason(): string {
    return `${this.name} import is not supported. Try a direct video file URL (mp4, webm, mkv, mov) or a supported platform (X, YouTube).`;
  }

  fetch(): Promise<never> {
    throw badRequest(this.disabledReason());
  }
}

const providers: VideoImportProvider[] = [
  new YouTubeImportProvider(),
  new XImportProvider(),
  new SocialStubProvider("Facebook", ["facebook.com", "fb.watch"]),
  new SocialStubProvider("Instagram", ["instagram.com"]),
  new SocialStubProvider("LinkedIn", ["linkedin.com"]),
  new SocialStubProvider("TikTok", ["tiktok.com"]),
  new DirectUrlImportProvider(),
];

export function resolveImportProvider(url: URL): VideoImportProvider {
  return providers.find((p) => p.matches(url)) ?? providers[providers.length - 1];
}

export interface ImportResult {
  key: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  provider: string;
}

// Validates the URL synchronously (format, protocol, provider match/enabled)
// so obviously-bad requests fail fast in the HTTP request, before any
// background work starts.
export function validateImportUrl(rawUrl: string): { url: URL; provider: VideoImportProvider } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("Only http(s) URLs can be imported");
  }
  const provider = resolveImportProvider(url);
  if (!provider.isEnabled()) {
    throw badRequest(provider.disabledReason() ?? "Import provider is disabled");
  }
  return { url, provider };
}

// Downloads a remote video through the import abstraction into object storage.
export async function importVideoFromUrl(
  videoId: number,
  rawUrl: string,
): Promise<ImportResult> {
  const { url, provider } = validateImportUrl(rawUrl);

  const imported = await provider.fetch(url);
  const ext = IMPORT_MIME_EXTENSIONS[imported.mimeType] ?? ".mp4";
  const key = `videos/${videoId}/${randomBytes(8).toString("hex")}${ext}`;

  // Enforce the size cap while streaming, not just via the declared length.
  // A Transform keeps backpressure intact (a plain "data" listener would put
  // the source in flowing mode and lose bytes before the pipeline attaches).
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      received += chunk.length;
      if (received > maxUploadBytes()) {
        callback(badRequest("Remote file exceeds the upload size limit"));
        return;
      }
      callback(null, chunk);
    },
  });
  imported.stream.on("error", (err) => limiter.destroy(err));

  try {
    const { sizeBytes } = await getVideoStorage().save(
      key,
      imported.stream.pipe(limiter),
    );
    return {
      key,
      mimeType: imported.mimeType,
      fileName: imported.fileName,
      sizeBytes,
      provider: provider.name,
    };
  } catch (err) {
    // Never leave a partial/abandoned object behind on failure.
    await getVideoStorage().delete(key).catch(() => {});
    throw err;
  }
}

// ── Import job status (in-process) ─────────────────────────────────────────
// Remote downloads can take minutes; the HTTP request must not block. The
// route starts the import in the background and tracks the outcome here (and
// persistently on the video row: PROCESSING → PENDING_REVIEW | FAILED, with
// the failure detail in storage_meta). In-process state is fine for a
// single-node deployment; the DB row remains the source of truth across
// restarts.

export type ImportJobState = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ImportJobStatus {
  state: ImportJobState;
  provider: string;
  error: string | null;
  updatedAt: string;
}

const importJobs = new Map<number, ImportJobStatus>();

export function getImportJobStatus(videoId: number): ImportJobStatus | null {
  return importJobs.get(videoId) ?? null;
}

export function setImportJobStatus(
  videoId: number,
  status: Omit<ImportJobStatus, "updatedAt">,
): ImportJobStatus {
  const next = { ...status, updatedAt: new Date().toISOString() };
  importJobs.set(videoId, next);
  return next;
}
