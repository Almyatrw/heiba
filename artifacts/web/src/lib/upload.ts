import type {
  CreateDirectUploadBody,
  CreateDirectUpload200,
  GetUploadCapabilities200,
} from "@workspace/api-client-react";

// Client-side direct upload: browser → object storage via presigned URLs.
// The API server validates metadata, tracks the job in PostgreSQL, and never
// proxies the bytes when the storage provider supports presigning (R2). The
// local development provider does not — callers fall back to proxyUpload.

const MAX_PART_RETRIES = 3;

export interface UploadProgress {
  loaded: number;
  total: number;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function getUploadCapabilities(
  videoId: number,
): Promise<GetUploadCapabilities200> {
  return apiFetch(`/api/videos/${videoId}/upload-capabilities`);
}

function putWithProgress(
  url: string,
  body: Blob,
  mimeType: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", mimeType);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.getResponseHeader("etag") ?? "").replaceAll('"', ""));
      } else {
        reject(new Error(`Part upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error && err.message === "Upload aborted") throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Uploads a file straight to object storage. Progress is reported per byte;
 * failed parts are retried; aborting cancels in-flight requests AND aborts
 * the multipart upload server-side so no orphaned parts remain.
 */
export async function directUpload(
  videoId: number,
  file: File,
  capabilities: GetUploadCapabilities200,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const body: CreateDirectUploadBody = {
    sizeBytes: file.size,
    mimeType: file.type || "video/mp4",
    fileName: file.name,
  };
  const prepared = await apiFetch<CreateDirectUpload200>(
    `/api/videos/${videoId}/direct-upload`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  try {
    if (prepared.mode === "single" && prepared.url) {
      await putWithProgress(prepared.url, file, body.mimeType, (loaded) =>
        onProgress({ loaded, total: file.size }),
      signal);
    } else {
      const partSize = capabilities.multipartPartSize;
      const etags: { partNumber: number; etag: string }[] = [];
      let uploaded = 0;
      for (const part of prepared.parts) {
        const start = (part.partNumber - 1) * partSize;
        const chunk = file.slice(start, Math.min(start + partSize, file.size));
        let partBase = 0;
        const etag = await withRetry(() => {
          partBase = uploaded;
          return putWithProgress(part.url, chunk, body.mimeType, (loaded) => {
            onProgress({ loaded: partBase + loaded, total: file.size });
          }, signal);
        });
        uploaded += chunk.size;
        etags.push({ partNumber: part.partNumber, etag });
      }
      await apiFetch(
        `/api/videos/${videoId}/direct-upload/${prepared.uploadId}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parts: etags }),
        },
      );
      return;
    }

    // Single-PUT: completion still runs through the tracked job endpoint.
    await apiFetch(
      `/api/videos/${videoId}/direct-upload/${prepared.uploadId}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: [] }),
      },
    );
  } catch (err) {
    // Abort incomplete uploads so storage never keeps orphaned parts.
    await apiFetch(
      `/api/videos/${videoId}/direct-upload/${prepared.uploadId}/abort`,
      { method: "POST" },
    ).catch(() => {});
    throw err;
  }
}

/** Fallback for providers without presigning: server-mediated upload with progress. */
export function proxyUpload(
  videoId: number,
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/videos/${videoId}/file`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) =>
      onProgress({ loaded: e.loaded, total: e.total || file.size });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string };
          reject(new Error(body.message ?? `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    const data = new FormData();
    data.append("file", file);
    xhr.send(data);
  });
}

/** Start a background URL import via the API. Returns once the server accepted the job (HTTP 202). */
export function importFromUrl(videoId: number, url: string): Promise<void> {
  return apiFetch(`/api/videos/${videoId}/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export interface ImportStatus {
  state: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | null;
  provider: string | null;
  error: string | null;
  videoStatus: string;
  updatedAt: string | null;
}

export function getImportStatus(videoId: number): Promise<ImportStatus> {
  return apiFetch(`/api/videos/${videoId}/import-status`);
}

const IMPORT_POLL_INTERVAL_MS = 2_000;
const IMPORT_POLL_TIMEOUT_MS = 10 * 60_000;

/** Polls until the background import finishes; resolves with the final status. */
export async function waitForImport(
  videoId: number,
  onTick?: (status: ImportStatus) => void,
  signal?: AbortSignal,
): Promise<ImportStatus> {
  const deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) throw new Error("Import aborted");
    const status = await getImportStatus(videoId);
    onTick?.(status);
    if (status.state === "COMPLETED" || status.state === "FAILED") return status;
    if (Date.now() > deadline) {
      throw new Error("Import timed out while waiting for the server");
    }
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS));
  }
}
