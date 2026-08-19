import { Router, type IRouter, type Request, type Response } from "express";
import { StreamVideoParams } from "@workspace/api-zod";
import { HttpError, notFound } from "../lib/errors";
import { getVideoStorage } from "../lib/storage";
import { canStream, getVideoOr404 } from "../lib/video-library";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

interface ByteRange {
  start: number;
  end: number;
}

function rangeNotSatisfiable(size: number): HttpError {
  return new HttpError(
    416,
    "RANGE_NOT_SATISFIABLE",
    `Range not satisfiable (size ${size})`,
  );
}

// RFC 7233 single-range parsing: "bytes=start-end", "bytes=start-",
// "bytes=-suffix". Multiple ranges are not supported.
function parseRange(header: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    throw rangeNotSatisfiable(size);
  }
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) throw rangeNotSatisfiable(size);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === "" ? size - 1 : Number.parseInt(match[2], 10);
    if (start > end || start >= size) throw rangeNotSatisfiable(size);
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const { id } = StreamVideoParams.parse(req.params);
  const video = await getVideoOr404(id);

  // 404 (not 403) for everything the user must not know exists
  if (!(await canStream(req.auth!.user, video))) {
    throw notFound("Video not found");
  }

  const storage = getVideoStorage();
  const stat = await storage.stat(video.storage_key!);
  if (!stat) throw notFound("Video file is missing");

  const size = stat.sizeBytes ?? video.size_bytes;
  if (size === null || size === 0) throw notFound("Video file is empty");

  let status = 200;
  let byteRange: ByteRange = { start: 0, end: size - 1 };
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    try {
      byteRange = parseRange(rangeHeader, size);
    } catch (err) {
      if (err instanceof HttpError && err.status === 416) {
        res.set("Content-Range", `bytes */${size}`);
      }
      throw err;
    }
    status = 206;
  }

  res.status(status);
  res.set({
    "Content-Type": video.mime_type ?? "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": byteRange.end - byteRange.start + 1,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // Safe display name only — the internal storage key is never exposed
    "Content-Disposition": `inline; filename="video-${id}"`,
  });
  if (status === 206) {
    res.set("Content-Range", `bytes ${byteRange.start}-${byteRange.end}/${size}`);
  }

  const stream = await storage.openReadStream(video.storage_key!, {
    start: byteRange.start,
    end: byteRange.end,
  });
  stream.on("error", () => {
    res.destroy();
  });
  stream.pipe(res);
});

export default router;
