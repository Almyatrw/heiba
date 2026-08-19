import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import {
  getGetLibraryVideoQueryKey,
  getGetVideoQueryKey,
  useGetLibraryVideo,
  useGetVideo,
} from "@workspace/api-client-react";
import { Badge, Spinner } from "@/components/ui";
import { formatBytes, formatDate, formatDuration, streamUrl } from "@/lib/format";
import { isAdmin, useAuth } from "@/lib/auth";

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { user } = useAuth();
  // Admins can preview any video (incl. unapproved); members use the library
  // endpoint which 404s anything not shared with them.
  const adminView = useGetVideo(id, {
    query: { queryKey: getGetVideoQueryKey(id), enabled: isAdmin(user) },
  });
  const memberView = useGetLibraryVideo(id, {
    query: { queryKey: getGetLibraryVideoQueryKey(id), enabled: !isAdmin(user) },
  });
  const video = isAdmin(user) ? adminView : memberView;

  if (video.isLoading) return <Spinner label="Dimming the lights…" />;

  if (!video.data) {
    return (
      <div className="rise">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-bone"
        >
          <ArrowLeft className="h-4 w-4" /> Back to library
        </Link>
        <div className="rounded-2xl border border-dashed border-line py-24 text-center">
          <p className="font-display text-2xl text-bone">Reel not found</p>
          <p className="mt-2 text-sm text-muted">
            This title is unavailable or not shared with you.
          </p>
        </div>
      </div>
    );
  }

  const v = video.data;

  return (
    <div className="rise mx-auto max-w-5xl">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-bone"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </Link>

      <div className="flicker-in overflow-hidden rounded-2xl border border-line bg-black shadow-[0_40px_120px_rgba(0,0,0,0.6)]">
        <video
          key={v.id}
          className="aspect-video w-full"
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload"
          src={streamUrl(v.id)}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-display text-4xl font-medium tracking-tight text-bone">
            {v.title}
          </h1>
          {v.description ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
              {v.description}
            </p>
          ) : null}
          {v.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {v.tags.map((tag) => (
                <Badge key={tag} tone="ember">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <dl className="shrink-0 space-y-2 rounded-xl border border-line bg-panel p-4 font-mono text-xs text-muted">
          <div className="flex justify-between gap-8">
            <dt>Duration</dt>
            <dd className="text-bone">{formatDuration(v.durationSeconds)}</dd>
          </div>
          <div className="flex justify-between gap-8">
            <dt>Size</dt>
            <dd className="text-bone">{formatBytes(v.sizeBytes)}</dd>
          </div>
          <div className="flex justify-between gap-8">
            <dt>Added</dt>
            <dd className="text-bone">{formatDate(v.createdAt)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
