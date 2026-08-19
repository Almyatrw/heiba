import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Users, UserMinus } from "lucide-react";
import {
  useAddGroupMember,
  useCreateGroup,
  useDeleteGroup,
  useListGroupMembers,
  useListGroups,
  useListUsers,
  useRemoveGroupMember,
  useUpdateGroup,
  useUpdateGroupMember,
  type Group,
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
  Textarea,
} from "@/components/ui";
import { apiErrorMessage } from "@/lib/auth";

function MembersModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const queryClient = useQueryClient();
  const members = useListGroupMembers(group.id);
  const users = useListUsers({ limit: 100 });
  const addMember = useAddGroupMember();
  const updateMember = useUpdateGroupMember();
  const removeMember = useRemoveGroupMember();
  const [userId, setUserId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/groups/${group.id}`] });

  const memberIds = new Set((members.data?.members ?? []).map((m) => m.userId));
  const candidates = (users.data?.users ?? []).filter(
    (u) => u.isActive && !memberIds.has(u.id),
  );

  const add = async () => {
    if (userId === "") return;
    setError(null);
    try {
      await addMember.mutateAsync({
        id: group.id,
        data: { userId: Number(userId), roleInGroup: "member" },
      });
      setUserId("");
      await invalidate();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not add member"));
    }
  };

  return (
    <Modal title={`Members — ${group.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Select
            value={userId}
            onChange={(e) =>
              setUserId(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">Add a member…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} ({u.role})
              </option>
            ))}
          </Select>
          <Button
            disabled={userId === "" || addMember.isPending}
            onClick={() => void add()}
          >
            Add
          </Button>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {members.isLoading ? (
          <Spinner />
        ) : (members.data?.members ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No members yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {(members.data?.members ?? []).map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-bone">{m.email}</div>
                  <div className="font-mono text-[10px] text-muted">
                    {m.role} · joined {new Date(m.joinedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    className="w-32"
                    value={m.roleInGroup}
                    onChange={async (e) => {
                      await updateMember.mutateAsync({
                        id: group.id,
                        userId: m.userId,
                        data: { roleInGroup: e.target.value as "member" | "manager" },
                      });
                      await invalidate();
                    }}
                  >
                    <option value="member">member</option>
                    <option value="manager">manager</option>
                  </Select>
                  <Button
                    variant="quiet"
                    className="px-2 hover:text-danger"
                    onClick={async () => {
                      await removeMember.mutateAsync({ id: group.id, userId: m.userId });
                      await invalidate();
                    }}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export default function GroupsPage() {
  const queryClient = useQueryClient();
  const groups = useListGroups({ limit: 100 });
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [membersFor, setMembersFor] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateGroup();
  const update = useUpdateGroup();
  const remove = useDeleteGroup();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/groups"] });

  const open = (target: Group | "new") => {
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
      setError(apiErrorMessage(err, "Save failed"));
    }
  };

  const removeGroup = async (id: number) => {
    if (!confirm("Delete this group? Videos keep their other access groups.")) return;
    await remove.mutateAsync({ id });
    await invalidate();
  };

  const items = groups.data?.groups ?? [];

  return (
    <div className="rise">
      <PageHeader
        kicker="Manage"
        title="Groups"
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> New group
          </Button>
        }
      />
      {groups.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body="Groups control who can watch what. Videos are private by default."
          action={
            <Button onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> Create the first group
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((g) => (
            <div key={g.id} className="rounded-xl border border-line bg-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-xl font-medium text-bone">
                    {g.name}
                  </h3>
                  {g.description ? (
                    <p className="mt-1 text-sm text-muted">{g.description}</p>
                  ) : null}
                  <Badge tone="neutral" className="mt-3">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </Badge>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="quiet" className="px-2" onClick={() => setMembersFor(g)} title="Manage members">
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button variant="quiet" className="px-2" onClick={() => open(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="quiet"
                    className="px-2 hover:text-danger"
                    onClick={() => void removeGroup(g.id)}
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
          title={editing === "new" ? "New group" : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description (optional)">
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || create.isPending || update.isPending}
                onClick={() => void save()}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {membersFor ? (
        <MembersModal group={membersFor} onClose={() => setMembersFor(null)} />
      ) : null}
    </div>
  );
}
