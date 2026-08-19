import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createSessionFor,
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

describe("health endpoint (Phase 0 regression)", () => {
  it("returns ok without authentication", async () => {
    const res = await api().get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("RBAC: /api/admin/users", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await api().get("/api/admin/users");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("allows OWNER", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api()
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("allows ADMIN", async () => {
    const { token } = await loginAs("ADMIN");
    const res = await api()
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("forbids GROUP_MANAGER", async () => {
    const { token } = await loginAs("GROUP_MANAGER");
    const res = await api()
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("forbids MEMBER", async () => {
    const { token } = await loginAs("MEMBER");
    const res = await api()
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("never exposes password hashes in the user list", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api()
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("$argon2id$");
  });

  it("supports pagination and role filter", async () => {
    const { token } = await loginAs("OWNER");
    await loginAs("MEMBER");
    await loginAs("MEMBER");
    await loginAs("ADMIN");

    const page1 = await api()
      .get("/api/admin/users?limit=2&offset=0")
      .set("Authorization", `Bearer ${token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.users).toHaveLength(2);
    expect(page1.body.total).toBe(4);

    const page2 = await api()
      .get("/api/admin/users?limit=2&offset=2")
      .set("Authorization", `Bearer ${token}`);
    expect(page2.body.users).toHaveLength(2);
    expect(page2.body.users[0].id).not.toBe(page1.body.users[0].id);

    const members = await api()
      .get("/api/admin/users?role=MEMBER")
      .set("Authorization", `Bearer ${token}`);
    expect(members.body.total).toBe(2);
    for (const u of members.body.users) {
      expect(u.role).toBe("MEMBER");
    }
  });

  it("rejects invalid pagination params", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api()
      .get("/api/admin/users?limit=0")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("RBAC: /api/admin/sessions/:id (owner-only session termination)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await api().delete("/api/admin/sessions/1");
    expect(res.status).toBe(401);
  });

  it("forbids ADMIN (no automatic owner permissions)", async () => {
    const { user } = await createUser();
    const { session } = await createSessionFor(user.id);
    const { token } = await loginAs("ADMIN");
    const res = await api()
      .delete(`/api/admin/sessions/${session.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("forbids GROUP_MANAGER", async () => {
    const { user } = await createUser();
    const { session } = await createSessionFor(user.id);
    const { token } = await loginAs("GROUP_MANAGER");
    const res = await api()
      .delete(`/api/admin/sessions/${session.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("forbids MEMBER", async () => {
    const { user } = await createUser();
    const { session } = await createSessionFor(user.id);
    const { token } = await loginAs("MEMBER");
    const res = await api()
      .delete(`/api/admin/sessions/${session.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows OWNER to terminate another user's session", async () => {
    const victim = await createUser({ email: "victim@example.com" });
    const victimSession = await createSessionFor(victim.user.id);
    const { token } = await loginAs("OWNER");

    const res = await api()
      .delete(`/api/admin/sessions/${victimSession.session.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const me = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${victimSession.token}`);
    expect(me.status).toBe(401);
  });

  it("returns 404 for a nonexistent session", async () => {
    const { token } = await loginAs("OWNER");
    const res = await api()
      .delete("/api/admin/sessions/424242")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
