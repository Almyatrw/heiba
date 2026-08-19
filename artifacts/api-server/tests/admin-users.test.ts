import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  api,
  authAs,
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

describe("admin user creation", () => {
  it("OWNER can create users of every role", async () => {
    const { token } = await loginAs("OWNER");
    for (const role of ["ADMIN", "GROUP_MANAGER", "MEMBER"] as const) {
      const res = await api()
        .post("/api/admin/users")
        .set(authAs(token))
        .send({
          email: `new-${role.toLowerCase()}@example.com`,
          password: "initial-pass-123",
          role,
        });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe(role);
      expect(res.body.isActive).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain("password");
      expect(res.body.id).toBeGreaterThan(0);
    }
  });

  it("created user can log in with the assigned password", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api().post("/api/admin/users").set(authAs(token)).send({
      email: "fresh@example.com",
      password: "initial-pass-123",
      role: "MEMBER",
    });
    expect(res.status).toBe(201);

    const login = await api()
      .post("/api/auth/login")
      .send({ email: "fresh@example.com", password: "initial-pass-123" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("MEMBER");
  });

  it("ADMIN can create MEMBER/GROUP_MANAGER but not ADMIN/OWNER", async () => {
    const { token } = await loginAs("ADMIN");

    const ok = await api().post("/api/admin/users").set(authAs(token)).send({
      email: "by-admin@example.com",
      password: "initial-pass-123",
      role: "GROUP_MANAGER",
    });
    expect(ok.status).toBe(201);

    for (const role of ["ADMIN", "OWNER"] as const) {
      const res = await api().post("/api/admin/users").set(authAs(token)).send({
        email: `escalation-${role}@example.com`,
        password: "initial-pass-123",
        role,
      });
      expect(res.status).toBe(403);
    }
  });

  it("MEMBER and GROUP_MANAGER cannot create users", async () => {
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");
    for (const { token } of [member, manager]) {
      const res = await api().post("/api/admin/users").set(authAs(token)).send({
        email: "nope@example.com",
        password: "initial-pass-123",
        role: "MEMBER",
      });
      expect(res.status).toBe(403);
    }
  });

  it("rejects duplicate emails with 409", async () => {
    const { token } = await loginAs("OWNER");
    await createUser({ email: "dup@example.com" });
    const res = await api().post("/api/admin/users").set(authAs(token)).send({
      email: "dup@example.com",
      password: "initial-pass-123",
      role: "MEMBER",
    });
    expect(res.status).toBe(409);
  });

  it("validates the body", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api().post("/api/admin/users").set(authAs(token)).send({
      email: "not-an-email",
      password: "short",
      role: "MEMBER",
    });
    expect(res.status).toBe(400);
  });
});

describe("admin user update", () => {
  it("OWNER can change roles including to/from ADMIN", async () => {
    const { token } = await loginAs("OWNER");
    const { user } = await createUser({ role: "MEMBER" });

    const res = await api()
      .patch(`/api/admin/users/${user.id}`)
      .set(authAs(token))
      .send({ role: "ADMIN" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
  });

  it("ADMIN cannot modify OWNER or ADMIN accounts", async () => {
    const { token } = await loginAs("ADMIN");
    const owner = await createUser({ role: "OWNER" });
    const admin = await createUser({ role: "ADMIN" });

    for (const target of [owner.user, admin.user]) {
      const res = await api()
        .patch(`/api/admin/users/${target.id}`)
        .set(authAs(token))
        .send({ role: "MEMBER" });
      expect(res.status).toBe(403);
    }
  });

  it("ADMIN cannot promote a member to ADMIN (privilege escalation)", async () => {
    const { token } = await loginAs("ADMIN");
    const { user } = await createUser({ role: "MEMBER" });
    const res = await api()
      .patch(`/api/admin/users/${user.id}`)
      .set(authAs(token))
      .send({ role: "ADMIN" });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(row.role).toBe("MEMBER");
  });

  it("nobody can modify their own account via admin routes", async () => {
    const { user, token } = await loginAs("OWNER");
    const res = await api()
      .patch(`/api/admin/users/${user.id}`)
      .set(authAs(token))
      .send({ role: "MEMBER" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown users", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api()
      .patch("/api/admin/users/987654")
      .set(authAs(token))
      .send({ role: "MEMBER" });
    expect(res.status).toBe(404);
  });
});

describe("admin user deactivation", () => {
  it("deactivates the account and revokes all sessions", async () => {
    const { token } = await loginAs("OWNER");
    const member = await createUser({ role: "MEMBER" });
    const memberLogin = await loginUser(member.user.email, member.password);

    const res = await api()
      .delete(`/api/admin/users/${member.user.id}`)
      .set(authAs(token));
    expect(res.status).toBe(204);

    // Existing session must be dead
    const me = await api()
      .get("/api/auth/me")
      .set(authAs(memberLogin.token));
    expect(me.status).toBe(401);

    // Login must be refused
    const login = await api()
      .post("/api/auth/login")
      .send({ email: member.user.email, password: member.password });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("ACCOUNT_DISABLED");
  });

  it("ADMIN cannot deactivate the OWNER", async () => {
    const { token } = await loginAs("ADMIN");
    const owner = await createUser({ role: "OWNER" });
    const res = await api()
      .delete(`/api/admin/users/${owner.user.id}`)
      .set(authAs(token));
    expect(res.status).toBe(403);
  });
});
