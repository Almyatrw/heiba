import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import {
  useListPendingReviews,
  useListVideoReviews,
  useReviewVideo,
  type Video,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/Layout";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Spinner,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { apiErrorMessage } from "@/lib/auth";
import { formatBytes, formatDate, streamUrl } from "@/lib/format";

function ReviewPanel({
  video,
  onDone,
}: {
  video: Video;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const review = useReviewVideo();
  const history = useListVideoReviews(video.id);

  const decide = async (action: "APPROVED" | "REJECTED") => {
    if (action === "REJECTED" && !notes.trim()) {
      setError("A note is required when rejecting.");
      return;
    }
    setError(null);
    setBusy(action);
    try {
      await review.mutateAsync({
        id: video.id,
        data: { action, notes: notes || undefined },
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Review failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-line bg-panel-2/50 p-5">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="overflow-hidden rounded-xl border border-line bg-black">
            <video
              key={video.id}
              className="aspect-video w-full"
              controls
              playsInline
              preload="metadata"
              src={streamUrl(video.id)}
            />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-muted">
            <span>{formatBytes(video.sizeBytes)}</span>
            <span>{video.mimeType ?? "unknown type"}</span>
            <span>uploaded {formatDate(video.updatedAt)}</span>
          </dl>
          {video.description ? (
            <p className="mt-3 text-sm text-muted">{video.description}</p>
          ) : null}
        </div>
        <div className="space-y-4">
          {history.data && history.data.reviews.length > 0 ? (
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-widest text-muted uppercase">
                Previous decisions
              </div>
              <ul className="space-y-2">
                {history.data.reviews.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-line bg-panel px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <StatusBadge status={r.action === "APPROVED" ? "APPROVED" : "REJECTED"} />
                      <span className="font-mono text-muted">
                        {formatDate(r.createdAt)}
                      </span>
                    </div>
                    {r.notes ? (
                      <p className="mt-1.5 text-muted">“{r.notes}”</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Field label="Notes (required to reject)">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this being approved or rejected?"
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              className="flex-1 !bg-moss !text-ink hover:!bg-moss/90"
              disabled={busy !== null}
              onClick={() => void decide("APPROVED")}
            >
              <CheckCircle2 className="h-4 w-4" />
              {busy === "APPROVED" ? "Approving…" : "Approve"}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void decide("REJECTED")}
            >
              <XCircle className="h-4 w-4" />
              {busy === "REJECTED" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const pending = useListPendingReviews({ limit: 100 });
  const [openId, setOpenId] = useState<number | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/pending"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/library/videos"] }),
    ]);

  const items = pending.data?.videos ?? [];

  return (
    <div className="rise">
      <PageHeader kicker="Manual review" title="Review queue" />
      {pending.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title="The queue is clear"
          body="Uploaded videos appear here for approval before members can see them."
        />
      ) : (
        <div className="space-y-3">
          {items.map((v) => {
            const open = openId === v.id;
            return (
              <div
                key={v.id}
                className="overflow-hidden rounded-2xl border border-line bg-panel"
              >
                <button
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  onClick={() => setOpenId(open ? null : v.id)}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <StatusBadge status={v.status} />
                    <div className="min-w-0">
                      <div className="truncate font-display text-lg font-medium text-bone">
                        {v.title}
                      </div>
                      <div className="font-mono text-[11px] text-muted">
                        {v.originalFileName ?? "no file"} · uploaded{" "}
                        {formatDate(v.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {v.groupIds.length === 0 ? (
                      <Badge tone="danger">No groups — stays private</Badge>
                    ) : null}
                    {open ? (
                      <ChevronUp className="h-4 w-4 text-muted" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted" />
                    )}
                  </div>
                </button>
                {open ? (
                  <ReviewPanel
                    video={v}
                    onDone={() => {
                      setOpenId(null);
                      void invalidate();
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
