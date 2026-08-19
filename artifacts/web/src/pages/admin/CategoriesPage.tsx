import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  useCreateCategory,
  useDeleteCategory,
  useListCategories,
  useUpdateCategory,
  type Category,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/Layout";
import { Button, EmptyState, Field, Input, Modal, Spinner, Textarea } from "@/components/ui";
import { apiErrorMessage } from "@/lib/auth";
import { useT } from "@/lib/i18n";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const t = useT();
  const categories = useListCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/categories"] });

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  const open = (target: Category | "new") => {
    setEditing(target);
    setName(target === "new" ? "" : target.name);
    setDescription(target === "new" ? "" : (target.description ?? ""));
    setError(null);
  };

  const save = async () => {
    setError(null);
    try {
      if (editing === "new") {
        await create.mutateAsync({
          data: { name, description: description || undefined },
        });
      } else if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: { name, description: description || null },
        });
      }
      await invalidate();
      setEditing(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("common.saveFailed")));
    }
  };

  const removeCategory = async (id: number) => {
    if (!confirm(t("categories.deleteConfirm"))) return;
    await remove.mutateAsync({ id });
    await invalidate();
  };

  const items = categories.data?.categories ?? [];

  return (
    <div className="rise">
      <PageHeader
        kicker={t("nav.manage")}
        title={t("categories.title")}
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> {t("categories.new")}
          </Button>
        }
      />
      {categories.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("categories.emptyTitle")}
          body={t("categories.emptyBody")}
          action={
            <Button onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> {t("categories.createFirst")}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-line bg-panel p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-medium text-bone">
                    {c.name}
                  </h3>
                  {c.description ? (
                    <p className="mt-1 text-sm text-muted">{c.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="quiet" className="px-2" onClick={() => open(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="quiet"
                    className="px-2 hover:text-danger"
                    onClick={() => void removeCategory(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <Modal
          title={editing === "new" ? t("categories.new") : t("categories.edit", { name: editing.name })}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <Field label={t("groups.fieldName")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={`${t("groups.fieldDescription")} (${t("common.optional")})`}>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!name.trim() || create.isPending || update.isPending}
                onClick={() => void save()}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
