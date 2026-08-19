import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, UserX, UserCheck } from "lucide-react";
import {
  useCreateUser,
  useDeactivateUser,
  useListUsers,
  useUpdateUser,
  type User,
  type UserRole,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/Layout";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import { apiErrorMessage, useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";

const ROLES: UserRole[] = ["MEMBER", "GROUP_MANAGER", "ADMIN"];

export default function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const t = useT();
  const users = useListUsers({ limit: 100 });
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateUser();
  const update = useUpdateUser();
  const deactivate = useDeactivateUser();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });

  const open = (target: User | "new") => {
    setEditing(target);
    setEmail(target === "new" ? "" : target.email);
    setPassword("");
    setRole(target === "new" ? "MEMBER" : target.role);
    setError(null);
  };

  const save = async () => {
    setError(null);
    try {
      if (editing === "new") {
        await create.mutateAsync({ data: { email, password, role } });
      } else if (editing) {
        // The API deliberately does not allow changing email/password for
        // existing accounts here — only role changes.
        await update.mutateAsync({ id: editing.id, data: { role } });
      }
      await invalidate();
      setEditing(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("common.saveFailed")));
    }
  };

  const toggleActive = async (u: User) => {
    if (u.isActive) {
      if (!confirm(t("users.deactivateConfirm", { email: u.email }))) return;
      await deactivate.mutateAsync({ id: u.id });
    } else {
      await update.mutateAsync({ id: u.id, data: { isActive: true } });
    }
    await invalidate();
  };

  const items = users.data?.users ?? [];
  const canManage = me?.role === "OWNER";

  return (
    <div className="rise">
      <PageHeader
        kicker={t("nav.manage")}
        title={t("users.title")}
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> {t("users.invite")}
          </Button>
        }
      />
      {users.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title={t("users.emptyTitle")} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-widest text-muted uppercase">
                <th className="px-4 py-3">{t("users.colEmail")}</th>
                <th className="px-4 py-3">{t("users.colRole")}</th>
                <th className="px-4 py-3">{t("users.colStatus")}</th>
                <th className="px-4 py-3">{t("users.colJoined")}</th>
                <th className="px-4 py-3 text-end">{t("users.colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((u) => (
                <tr key={u.id} className="bg-panel">
                  <td className="px-4 py-3 text-bone">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.role === "OWNER" ? "ember" : "neutral"}>
                      {t(`role.${u.role}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.isActive ? "moss" : "danger"}>
                      {u.isActive ? t("users.active") : t("users.deactivated")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="quiet"
                        className="px-2"
                        disabled={u.role === "OWNER" && !canManage}
                        onClick={() => open(u)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {u.id !== me?.id && u.role !== "OWNER" ? (
                        <Button
                          variant="quiet"
                          className={u.isActive ? "px-2 hover:text-danger" : "px-2 hover:text-moss"}
                          title={u.isActive ? t("users.deactivate") : t("users.reactivate")}
                          onClick={() => void toggleActive(u)}
                        >
                          {u.isActive ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </Button>
                      ) : null}
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
          title={editing === "new" ? t("users.invite") : t("users.edit", { email: editing.email })}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            {editing === "new" ? (
              <>
                <Field label={t("login.email")}>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field
                  label={t("login.password")}
                  hint={t("users.passwordHint")}
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field label={t("users.colRole")}>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                disabled={
                  editing !== "new" && editing.role === "OWNER" && !canManage
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={
                  !email.trim() ||
                  (editing === "new" && !password) ||
                  create.isPending ||
                  update.isPending
                }
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
