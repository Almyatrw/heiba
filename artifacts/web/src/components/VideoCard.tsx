import { Play } from "lucide-react";
import { Link } from "wouter";
import type { Video } from "@workspace/api-client-react";
import { formatDuration, posterTone } from "@/lib/format";

export function VideoCard({ video, index = 0 }: { video: Video; index?: number }) {
  const tone = posterTone(video.id);
  return (
    <Link
      href={`/watch/${video.id}`}
      className="group rise block"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <div
        className="relative aspect-video overflow-hidden rounded-xl border border-line transition-transform duration-300 group-hover:-translate-y-1"
        style={{
          background: `linear-gradient(150deg, ${tone.from}, ${tone.to})`,
        }}
      >
        <div className="poster-sheen absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-display text-6xl font-light opacity-25"
            style={{ color: tone.ink }}
          >
            {video.title.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="absolute right-2 bottom-2 rounded-md bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] text-bone/90 backdrop-blur">
          {formatDuration(video.durationSeconds)}
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ember text-ink shadow-[0_0_40px_rgba(242,163,60,0.5)]">
            <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
          </span>
        </div>
      </div>
      <div className="mt-3">
        <h3 className="truncate font-display text-lg font-medium text-bone transition-colors group-hover:text-ember">
          {video.title}
        </h3>
        {video.tags.length > 0 && (
          <div className="mt-1 flex gap-1.5 overflow-hidden">
            {video.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
