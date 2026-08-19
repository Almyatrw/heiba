import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, Upload, Eye } from "lucide-react";
import {
  useCreateVideo,
  useDeleteVideo,
  useListCategories,
  useListGroups,
  useListVideos,
  useUpdateVideo,
  useUploadVideoFile,
  type CreateVideoInput,
  type Video,
  type VideoStatus,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/Layout";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { apiErrorMessage } from "@/lib/auth";
import { formatBytes, formatDate } from "@/lib/format";

const STATUS_OPTIONS: (VideoStatus | "")[] = [
  "",
  "PROCESSING",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "PRIVATE",
  "ARCHIVED",
];

function AssignmentChecks({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: { id: number; name: string }[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted">None yet</p>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-bone hover:bg-panel"
            >
              <input
                type="checkbox"
                className="accent-ember"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              {item.name}
            </label>
          ))
        )}
      </div>
    </Field>
  );
}

export default function VideosPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<VideoStatus | "">("");
  const videos = useListVideos({
    limit: 100,
    ...(statusFilter ? { status: statusFilter } : {}),
  });
  const categories = useListCategories();
  const groups = useListGroups({ limit: 100 });

  const [editing, setEditing] = useState<Video | "new" | null>(null);
  const [uploadingFor, setUploadingFor] = useState<Video | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    tags: "",
    categoryIds: [] as number[],
    groupIds: [] as number[],
  });
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const create = useCreateVideo();
  const update = useUpdateVideo();
  const remove = useDeleteVideo();
  const upload = useUploadVideoFile();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });

  const open = (target: Video | "new") => {
    setEditing(target);
    setForm(
      target === "new"
        ? { title: "", description: "", tags: "", categoryIds: [], groupIds: [] }
        : {
            title: target.title,
            description: target.description ?? "",
            tags: target.tags.join(", "),
            categoryIds: target.categoryIds,
            groupIds: target.groupIds,
          },
    );
    setError(null);
  };

  const toggle = (key: "categoryIds" | "groupIds", id: number) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));
  };

  const save = async () => {
    setError(null);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (editing === "new") {
        const data: CreateVideoInput = {
          title: form.title,
          description: form.description || undefined,
          tags,
          categoryIds: form.categoryIds,
          groupIds: form.groupIds,
        };
        await create.mutateAsync({ data });
      } else if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            title: form.title,
            description: form.description || null,
            tags,
            categoryIds: form.categoryIds,
            groupIds: form.groupIds,
          },
        });
      }
      await invalidate();
      setEditing(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Save failed"));
    }
  };

  const doUpload = async (file: File) => {
    if (!uploadingFor) return;
    setUploadError(null);
    try {
      await upload.mutateAsync({ id: uploadingFor.id, data: { file } });
      await invalidate();
      setUploadingFor(null);
    } catch (err) {
      setUploadError(apiErrorMessage(err, "Upload failed"));
    }
  };

  const removeVideo = async (v: Video) => {
    if (!confirm(`Delete "${v.title}"? The stored file is removed permanently.`)) return;
    await remove.mutateAsync({ id: v.id });
    await invalidate();
  };

  const items = videos.data?.videos ?? [];

  return (
    <div className="rise">
      <PageHeader
        kicker="Manage"
        title="Videos"
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> New video
          </Button>
        }
      />

      <div className="mb-6 w-56">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VideoStatus | "")}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s || "all"} value={s}>
              {s ? s.replace(/_/g, " ") : "All statuses"}
            </option>
          ))}
        </Select>
      </div>

      {videos.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title="No videos yet"
          body="Create a video entry, upload its file, then approve it from the review queue."
          action={
            <Button onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> Create the first video
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-widest text-muted uppercase">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((v) => (
                <tr key={v.id} className="bg-panel">
                  <td className="max-w-64 px-4 py-3">
                    <div className="truncate font-medium text-bone">{v.title}</div>
                    {v.tags.length > 0 && (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                        {v.tags.join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {v.originalFileName
                      ? `${v.originalFileName} (${formatBytes(v.sizeBytes)})`
                      : "no file"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {v.groupIds.length === 0
                      ? "private"
                      : `${v.groupIds.length} ${v.groupIds.length === 1 ? "group" : "groups"}`}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {formatDate(v.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {v.storageProvider ? (
                        <Link href={`/watch/${v.id}`}>
                          <Button variant="quiet" className="px-2" title="Watch">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : null}
                      <Button
                        variant="quiet"
                        className="px-2"
                        title={v.storageProvider ? "Replace file" : "Upload file"}
                        onClick={() => {
                          setUploadError(null);
                          setUploadingFor(v);
                        }}
                      >
                        <Upload className="h-4 w-4" />
                      </Button>
                      <Button variant="quiet" className="px-2" onClick={() => open(v)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="quiet"
                        className="px-2 hover:text-danger"
                        onClick={() => void removeVideo(v)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <Modal
          title={editing === "new" ? "New video" : `Edit ${editing.title}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <Field label="Title">
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <Field label="Description (optional)">
                <Textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </Field>
              <Field label="Tags" hint="Comma-separated">
                <Input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="onboarding, training"
                />
              </Field>
            </div>
            <div className="space-y-4">
              <AssignmentChecks
                label="Categories"
                items={categories.data?.categories ?? []}
                selected={form.categoryIds}
                onToggle={(id) => toggle("categoryIds", id)}
              />
              <AssignmentChecks
                label="Access groups"
                items={groups.data?.groups ?? []}
                selected={form.groupIds}
                onToggle={(id) => toggle("groupIds", id)}
              />
            </div>
          </div>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!form.title.trim() || create.isPending || update.isPending}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        </Modal>
      ) : null}

      {uploadingFor ? (
        <Modal
          title={`${uploadingFor.storageProvider ? "Replace" : "Upload"} file — ${uploadingFor.title}`}
          onClose={() => setUploadingFor(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              mp4, webm, mov, mkv, avi or m4v.{" "}
              {uploadingFor.storageProvider
                ? "Replacing the file sends the video back through manual review."
                : "After upload, the video waits in the review queue."}
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="video/*,.mkv,.avi,.mov,.m4v"
              className="block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-sm file:text-bone hover:file:bg-panel-2/80"
            />
            {upload.isPending ? (
              <Spinner label="Uploading…" />
            ) : uploadError ? (
              <p className="text-sm text-danger">{uploadError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setUploadingFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={upload.isPending}
                onClick={() => {
                  const file = fileInput.current?.files?.[0];
                  if (file) void doUpload(file);
                }}
              >
                Upload
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
