import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { badRequest } from "./errors";
import { getVideoStorage } from "./storage";
import { maxUploadBytes } from "./uploads";

// ── VideoImportProvider abstraction ────────────────────────────────────────
// Importing fetches a video from an external URL and stores it through the
// same VideoStorage boundary as uploads. V1 supports DIRECT file URLs only.
// Platform providers (YouTube, X, Facebook, Instagram, LinkedIn, TikTok) are
// stubs: they are recognised so users get a clear error, but never download
// anything — V1 does not bypass DRM, authentication, paywalls, or any other
// technical protection. YouTube can be explicitly enabled for videos the
// operator has rights to, via HEIBA_ENABLE_YOUTUBE_IMPORT=true.

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
    let current = url;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
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
}

// ── Platform stubs (recognised, never downloaded) ──────────────────────────

abstract class PlatformStubProvider implements VideoImportProvider {
  abstract readonly name: string;
  abstract readonly domains: string[];

  matches(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return this.domains.some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
  }

  isEnabled(): boolean {
    return false;
  }

  disabledReason(): string {
    return `${this.name} import is not supported in V1. Only direct video file URLs (mp4, webm, mkv, mov) can be imported.`;
  }

  fetch(): Promise<never> {
    throw badRequest(this.disabledReason());
  }
}

class YouTubeImportProvider extends PlatformStubProvider {
  readonly name = "YouTube";
  readonly domains = ["youtube.com", "youtu.be"];

  // YouTube stays disabled unless the operator explicitly enables it (and
  // then only for content they have rights to). When enabled, V1 still has
  // no downloader wired up — enabling only changes the error message.
  isEnabled(): boolean {
    return process.env.HEIBA_ENABLE_YOUTUBE_IMPORT === "true";
  }

  disabledReason(): string {
    return "YouTube import is disabled by default. Set HEIBA_ENABLE_YOUTUBE_IMPORT=true to enable it (requires a separately implemented, rights-respecting downloader).";
  }
}

class SocialStubProvider extends PlatformStubProvider {
  constructor(
    readonly name: string,
    readonly domains: string[],
  ) {
    super();
  }
}

const providers: VideoImportProvider[] = [
  new YouTubeImportProvider(),
  new SocialStubProvider("X", ["x.com", "twitter.com"]),
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
}

// Downloads a remote video through the import abstraction into object storage.
export async function importVideoFromUrl(
  videoId: number,
  rawUrl: string,
): Promise<ImportResult> {
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
    };
  } catch (err) {
    // Never leave a partial/abandoned object behind on failure.
    await getVideoStorage().delete(key).catch(() => {});
    throw err;
  }
}
