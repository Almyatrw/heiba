import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, userGroupsTable } from "@workspace/db";
import {
  addMember,
  api,
  authAs,
  createGroup,
  createUser,
  loginUser,
  resetDatabase,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

describe("group CRUD", () => {
  it("OWNER and ADMIN can create groups; others cannot", async () => {
    const owner = await loginAs("OWNER");
    const admin = await loginAs("ADMIN");
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");

    for (const { token } of [owner, admin]) {
      const res = await api()
        .post("/api/groups")
        .set(authAs(token))
        .send({ name: `g-${Math.random()}`, description: "d" });
      expect(res.status).toBe(201);
      expect(res.body.memberCount).toBe(0);
    }
    for (const { token } of [member, manager]) {
      const res = await api()
        .post("/api/groups")
        .set(authAs(token))
        .send({ name: "forbidden" });
      expect(res.status).toBe(403);
    }
  });

  it("rejects duplicate names per owner with 409 but allows across owners", async () => {
    const owner = await loginAs("OWNER");
    const admin = await loginAs("ADMIN");

    await api()
      .post("/api/groups")
      .set(authAs(owner.token))
      .send({ name: "shared-name" });
    const dup = await api()
      .post("/api/groups")
      .set(authAs(owner.token))
      .send({ name: "shared-name" });
    expect(dup.status).toBe(409);

    const other = await api()
      .post("/api/groups")
      .set(authAs(admin.token))
      .send({ name: "shared-name" });
    expect(other.status).toBe(201);
  });

  it("scopes group listing by role", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");
    const outsider = await loginAs("MEMBER");

    const g1 = await createGroup(owner.user.id);
    const g2 = await createGroup(owner.user.id);
    await createGroup(owner.user.id);
    await addMember(g1.id, member.user.id, "member");
    await addMember(g2.id, manager.user.id, "manager");

    const ownerList = await api().get("/api/groups").set(authAs(owner.token));
    expect(ownerList.body.total).toBe(3);

    const memberList = await api().get("/api/groups").set(authAs(member.token));
    expect(memberList.body.total).toBe(1);
    expect(memberList.body.groups[0].id).toBe(g1.id);
    expect(memberList.body.groups[0].memberCount).toBe(1);

    const managerList = await api()
      .get("/api/groups")
      .set(authAs(manager.token));
    expect(managerList.body.total).toBe(1);
    expect(managerList.body.groups[0].id).toBe(g2.id);

    const none = await api().get("/api/groups").set(authAs(outsider.token));
    expect(none.body.total).toBe(0);
  });

  it("hides groups from non-members (404)", async () => {
    const owner = await loginAs("OWNER");
    const outsider = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);

    const res = await api()
      .get(`/api/groups/${group.id}`)
      .set(authAs(outsider.token));
    expect(res.status).toBe(404);
  });

  it("only OWNER/ADMIN can update or delete groups; deletion cascades memberships", async () => {
    const owner = await loginAs("OWNER");
    const manager = await loginAs("GROUP_MANAGER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, manager.user.id, "manager");

    const forbiddenRes = await api()
      .patch(`/api/groups/${group.id}`)
      .set(authAs(manager.token))
      .send({ name: "renamed" });
    expect(forbiddenRes.status).toBe(403);

    const ok = await api()
      .patch(`/api/groups/${group.id}`)
      .set(authAs(owner.token))
      .send({ name: "renamed", description: null });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("renamed");

    const del = await api()
      .delete(`/api/groups/${group.id}`)
      .set(authAs(owner.token));
    expect(del.status).toBe(204);
    const remaining = await db
      .select()
      .from(userGroupsTable)
      .where(eq(userGroupsTable.group_id, group.id));
    expect(remaining).toHaveLength(0);
  });
});

describe("group membership management", () => {
  it("OWNER can add members; duplicates yield 409; unknown user 404", async () => {
    const owner = await loginAs("OWNER");
    const member = await createUser({ role: "MEMBER" });
    const group = await createGroup(owner.user.id);

    const res = await api()
      .post(`/api/groups/${group.id}/members`)
      .set(authAs(owner.token))
      .send({ userId: member.user.id, roleInGroup: "member" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(member.user.id);
    expect(res.body.roleInGroup).toBe("member");

    const dup = await api()
      .post(`/api/groups/${group.id}/members`)
      .set(authAs(owner.token))
      .send({ userId: member.user.id });
    expect(dup.status).toBe(409);

    const missing = await api()
      .post(`/api/groups/${group.id}/members`)
      .set(authAs(owner.token))
      .send({ userId: 999999 });
    expect(missing.status).toBe(404);
  });

  it("group managers manage members only in groups they manage", async () => {
    const owner = await loginAs("OWNER");
    const manager = await loginAs("GROUP_MANAGER");
    const member = await createUser({ role: "MEMBER" });
    const managed = await createGroup(owner.user.id);
    const unmanaged = await createGroup(owner.user.id);
    await addMember(managed.id, manager.user.id, "manager");

    const ok = await api()
      .post(`/api/groups/${managed.id}/members`)
      .set(authAs(manager.token))
      .send({ userId: member.user.id });
    expect(ok.status).toBe(201);

    const no = await api()
      .post(`/api/groups/${unmanaged.id}/members`)
      .set(authAs(manager.token))
      .send({ userId: member.user.id });
    expect(no.status).toBe(404); // not visible to them at all
  });

  it("managers cannot assign or modify managers (no privilege escalation)", async () => {
    const owner = await loginAs("OWNER");
    const manager = await loginAs("GROUP_MANAGER");
    const member = await createUser({ role: "MEMBER" });
    const otherManager = await createUser({ role: "MEMBER" });
    const group = await createGroup(owner.user.id);
    await addMember(group.id, manager.user.id, "manager");
    await addMember(group.id, member.user.id, "member");
    await addMember(group.id, otherManager.user.id, "manager");

    // add as manager (candidate exists but is not in the group yet)
    const candidate = await createUser({ role: "MEMBER" });
    const addRes = await api()
      .post(`/api/groups/${group.id}/members`)
      .set(authAs(manager.token))
      .send({ userId: candidate.user.id, roleInGroup: "manager" });
    expect(addRes.status).toBe(403);
    const promote = await api()
      .patch(`/api/groups/${group.id}/members/${member.user.id}`)
      .set(authAs(manager.token))
      .send({ roleInGroup: "manager" });
    expect(promote.status).toBe(403);

    const demote = await api()
      .patch(`/api/groups/${group.id}/members/${otherManager.user.id}`)
      .set(authAs(manager.token))
      .send({ roleInGroup: "member" });
    expect(demote.status).toBe(403);

    // OWNER can do it
    const byOwner = await api()
      .patch(`/api/groups/${group.id}/members/${member.user.id}`)
      .set(authAs(owner.token))
      .send({ roleInGroup: "manager" });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.roleInGroup).toBe("manager");
  });

  it("managers can remove members but not other managers", async () => {
    const owner = await loginAs("OWNER");
    const manager = await loginAs("GROUP_MANAGER");
    const member = await createUser({ role: "MEMBER" });
    const otherManager = await createUser({ role: "MEMBER" });
    const group = await createGroup(owner.user.id);
    await addMember(group.id, manager.user.id, "manager");
    await addMember(group.id, member.user.id, "member");
    await addMember(group.id, otherManager.user.id, "manager");

    const no = await api()
      .delete(`/api/groups/${group.id}/members/${otherManager.user.id}`)
      .set(authAs(manager.token));
    expect(no.status).toBe(403);

    const yes = await api()
      .delete(`/api/groups/${group.id}/members/${member.user.id}`)
      .set(authAs(manager.token));
    expect(yes.status).toBe(204);
    expect(await db.select().from(userGroupsTable)).toHaveLength(2);
  });

  it("members can list members of their own group; outsiders get 404", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const outsider = await loginAs("MEMBER");
    const group = await createGroup(owner.user.id);
    await addMember(group.id, member.user.id, "member");

    const ok = await api()
      .get(`/api/groups/${group.id}/members`)
      .set(authAs(member.token));
    expect(ok.status).toBe(200);
    expect(ok.body.members).toHaveLength(1);
    expect(ok.body.members[0].email).toBe(member.user.email);
    expect(JSON.stringify(ok.body)).not.toContain("password");

    const no = await api()
      .get(`/api/groups/${group.id}/members`)
      .set(authAs(outsider.token));
    expect(no.status).toBe(404);
  });

  it("unauthenticated requests are rejected", async () => {
    const res = await api().get("/api/groups");
    expect(res.status).toBe(401);
  });
});
