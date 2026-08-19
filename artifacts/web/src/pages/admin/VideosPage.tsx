import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, Upload, Eye, Link2, FileUp } from "lucide-react";
import {
  useCreateVideo,
  useDeleteVideo,
  useListCategories,
  useListGroups,
  useListVideos,
  useUpdateVideo,
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
import { useT } from "@/lib/i18n";
import {
  directUpload,
  getUploadCapabilities,
  importFromUrl,
  proxyUpload,
  type UploadProgress,
} from "@/lib/upload";

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
  const t = useT();
  return (
    <Field label={label}>
      <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted">{t("common.noneYet")}</p>
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

function UploadModal({
  video,
  onClose,
  onDone,
}: {
  video: Video;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [mode, setMode] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  const doUpload = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    setProgress({ loaded: 0, total: file.size });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const capabilities = await getUploadCapabilities(video.id);
      if (capabilities.directUploadSupported) {
        await directUpload(video.id, file, capabilities, setProgress, controller.signal);
      } else {
        await proxyUpload(video.id, file, setProgress, controller.signal);
      }
      await onDone();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t("upload.failed")));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const doImport = async () => {
    if (!url.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await importFromUrl(video.id, url.trim());
      await onDone();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t("upload.importFailed")));
    } finally {
      setBusy(false);
    }
  };

  const abort = () => abortRef.current?.abort();

  const action = video.storageProvider ? t("upload.replace") : t("upload.upload");

  return (
    <Modal
      title={t("upload.modalTitle", { action, title: video.title })}
      onClose={() => {
        abort();
        onClose();
      }}
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
          {(
            [
              ["file", t("upload.tabFile"), FileUp],
              ["url", t("upload.tabUrl"), Link2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => {
                setMode(key);
                setError(null);
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                mode === key
                  ? "bg-ember-soft text-ember"
                  : "text-muted hover:text-bone"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <>
            <p className="text-sm text-muted">
              {t("upload.hint", {
                suffix: video.storageProvider
                  ? t("upload.hintReplace")
                  : t("upload.hintNew"),
              })}
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
              className="block w-full text-sm text-muted file:me-4 file:rounded-lg file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-sm file:text-bone hover:file:bg-panel-2/80"
            />
            {progress && busy ? (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full bg-ember transition-[width]"
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-muted">
                  <span>
                    {t("upload.uploading")}{" "}
                    {pct !== null
                      ? `${pct}% — ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
                      : formatBytes(progress.loaded)}
                  </span>
                  <button
                    onClick={abort}
                    className="text-danger hover:underline"
                  >
                    {t("upload.abort")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Field label={t("upload.importUrlLabel")} hint={t("upload.importHint")}>
              <Input
                type="url"
                dir="ltr"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("upload.importUrlPlaceholder")}
              />
            </Field>
          </>
        )}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              abort();
              onClose();
            }}
          >
            {t("common.cancel")}
          </Button>
          {mode === "file" ? (
            <Button disabled={busy} onClick={() => void doUpload()}>
              {busy ? t("upload.uploading") : action}
            </Button>
          ) : (
            <Button disabled={busy || !url.trim()} onClick={() => void doImport()}>
              {busy ? t("upload.importing") : t("upload.import")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function VideosPage() {
  const queryClient = useQueryClient();
  const t = useT();
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

  const create = useCreateVideo();
  const update = useUpdateVideo();
  const remove = useDeleteVideo();

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
      .map((tag) => tag.trim())
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
      setError(apiErrorMessage(err, t("common.saveFailed")));
    }
  };

  const removeVideo = async (v: Video) => {
    if (!confirm(t("videos.deleteConfirm", { title: v.title }))) return;
    await remove.mutateAsync({ id: v.id });
    await invalidate();
  };

  const items = videos.data?.videos ?? [];

  return (
    <div className="rise">
      <PageHeader
        kicker={t("nav.manage")}
        title={t("videos.title")}
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> {t("videos.new")}
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
              {s ? t(`status.${s}`) : t("videos.allStatuses")}
            </option>
          ))}
        </Select>
      </div>

      {videos.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("videos.emptyTitle")}
          body={t("videos.emptyBody")}
          action={
            <Button onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> {t("videos.createFirst")}
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-widest text-muted uppercase">
                <th className="px-4 py-3">{t("videos.colTitle")}</th>
                <th className="px-4 py-3">{t("videos.colStatus")}</th>
                <th className="px-4 py-3">{t("videos.colFile")}</th>
                <th className="px-4 py-3">{t("videos.colAccess")}</th>
                <th className="px-4 py-3">{t("videos.colCreated")}</th>
                <th className="px-4 py-3 text-end">{t("videos.colActions")}</th>
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
                      : t("videos.noFile")}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {v.groupIds.length === 0
                      ? t("videos.private")
                      : t(v.groupIds.length === 1 ? "videos.group" : "videos.groups", {
                          count: v.groupIds.length,
                        })}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {formatDate(v.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {v.storageProvider ? (
                        <Link href={`/watch/${v.id}`}>
                          <Button variant="quiet" className="px-2" title={t("videos.watch")}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : null}
                      <Button
                        variant="quiet"
                        className="px-2"
                        title={
                          v.storageProvider
                            ? t("videos.replaceFile")
                            : t("videos.uploadFile")
                        }
                        onClick={() => setUploadingFor(v)}
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
          title={
            editing === "new"
              ? t("videos.new")
              : t("videos.edit", { title: editing.title })
          }
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <Field label={t("videos.fieldTitle")}>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <Field label={`${t("videos.fieldDescription")} (${t("common.optional")})`}>
                <Textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </Field>
              <Field label={t("videos.fieldTags")} hint={t("videos.tagsHint")}>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder={t("videos.tagsPlaceholder")}
                />
              </Field>
            </div>
            <div className="space-y-4">
              <AssignmentChecks
                label={t("videos.fieldCategories")}
                items={categories.data?.categories ?? []}
                selected={form.categoryIds}
                onToggle={(id) => toggle("categoryIds", id)}
              />
              <AssignmentChecks
                label={t("videos.fieldGroups")}
                items={groups.data?.groups ?? []}
                selected={form.groupIds}
                onToggle={(id) => toggle("groupIds", id)}
              />
            </div>
          </div>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!form.title.trim() || create.isPending || update.isPending}
              onClick={() => void save()}
            >
              {t("common.save")}
            </Button>
          </div>
        </Modal>
      ) : null}

      {uploadingFor ? (
        <UploadModal
          video={uploadingFor}
          onClose={() => setUploadingFor(null)}
          onDone={invalidate}
        />
      ) : null}
    </div>
  );
}
