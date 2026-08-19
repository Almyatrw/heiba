import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import {
  api,
  createSessionFor,
  createUser,
  loginUser,
  resetDatabase,
} from "./helpers";
import { hashSessionToken } from "../src/lib/session-token";

const SESSION_COOKIE = "heiba_session";

beforeEach(async () => {
  await resetDatabase();
});

describe("login", () => {
  it("authenticates a valid user and returns user + token", async () => {
    const { user, password } = await createUser({ role: "MEMBER" });
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.role).toBe("MEMBER");
    expect(res.body.user.isActive).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
  });

  it("sets an httpOnly session cookie", async () => {
    const { user, password } = await createUser();
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password });
    const cookies = res.headers["set-cookie"] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
  });

  it("never exposes password hashes or session-token hashes", async () => {
    const { user, password } = await createUser();
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("$argon2id$");
    expect(body).not.toContain("session_token_hash");
    expect(body).not.toContain("sessionTokenHash");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("persists the session as a hash, never the raw token", async () => {
    const { user, password } = await createUser();
    const { token } = await loginUser(user.email, password);

    const rows = await db.select().from(sessionsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_token_hash).toBe(hashSessionToken(token));
    expect(rows[0].session_token_hash).not.toBe(token);
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].revoked).toBe(false);
    expect(rows[0].expires_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a wrong password with 401", async () => {
    const { user } = await createUser();
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown email with the same 401 (no user enumeration)", async () => {
    await createUser();
    const res = await api()
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects a deactivated account with 403", async () => {
    const { user, password } = await createUser({ isActive: false });
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DISABLED");
  });

  it("validates the request body (short password rejected)", async () => {
    const res = await api()
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("session validation", () => {
  it("accepts a valid bearer token on /auth/me", async () => {
    const { user, password } = await createUser({ role: "ADMIN" });
    const { token } = await loginUser(user.email, password);

    const res = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.role).toBe("ADMIN");
    expect(res.body.session.current).toBe(true);
    expect(res.body.session.revoked).toBe(false);
  });

  it("accepts the session cookie", async () => {
    const { user, password } = await createUser();
    const loginRes = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password });
    const cookies = loginRes.headers["set-cookie"] as unknown as string[];

    const res = await api().get("/api/auth/me").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it("rejects requests without credentials", async () => {
    const res = await api().get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an invalid token", async () => {
    const res = await api()
      .get("/api/auth/me")
      .set("Authorization", "Bearer totally-made-up-token");
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { user } = await createUser();
    const { token } = await createSessionFor(user.id, { expiresInMs: -1000 });
    const res = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a revoked session", async () => {
    const { user } = await createUser();
    const { token } = await createSessionFor(user.id, { revoked: true });
    const res = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("ignores client-supplied role claims (privilege escalation)", async () => {
    const { user, password } = await createUser({ role: "MEMBER" });
    // Even if the client claims a role, the server only trusts the session/DB.
    const res = await api()
      .post("/api/auth/login")
      .send({ email: user.email, password, role: "OWNER" });
    expect(res.status).toBe(200);

    const me = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .set("X-User-Role", "OWNER");
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("MEMBER");
  });
});

describe("logout and revocation", () => {
  it("logout revokes the current session", async () => {
    const { user, password } = await createUser();
    const { token } = await loginUser(user.email, password);

    const out = await api()
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(204);

    const me = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);

    const [row] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.session_token_hash, hashSessionToken(token)));
    expect(row.revoked).toBe(true);
    expect(row.revoked_at).not.toBeNull();
  });

  it("logout-all revokes every session of the user", async () => {
    const { user, password } = await createUser();
    const first = await loginUser(user.email, password);
    const second = await loginUser(user.email, password);

    const out = await api()
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${second.token}`);
    expect(out.status).toBe(204);

    for (const token of [first.token, second.token]) {
      const me = await api()
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(401);
    }
  });

  it("logout requires authentication", async () => {
    const res = await api().post("/api/auth/logout");
    expect(res.status).toBe(401);
  });
});

describe("own session management", () => {
  it("lists only active sessions of the current user", async () => {
    const { user, password } = await createUser();
    await loginUser(user.email, password);
    const current = await loginUser(user.email, password);
    await createSessionFor(user.id, { revoked: true });
    await createSessionFor(user.id, { expiresInMs: -1000 });

    const res = await api()
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${current.token}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    const currents = res.body.sessions.filter(
      (s: { current: boolean }) => s.current,
    );
    expect(currents).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("session_token_hash");
  });

  it("revokes another own session while keeping the current one", async () => {
    const { user, password } = await createUser();
    const other = await loginUser(user.email, password);
    const current = await loginUser(user.email, password);

    const list = await api()
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${current.token}`);
    const otherInfo = list.body.sessions.find(
      (s: { current: boolean }) => !s.current,
    );

    const del = await api()
      .delete(`/api/auth/sessions/${otherInfo.id}`)
      .set("Authorization", `Bearer ${current.token}`);
    expect(del.status).toBe(204);

    const revoked = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${other.token}`);
    expect(revoked.status).toBe(401);

    const stillValid = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${current.token}`);
    expect(stillValid.status).toBe(200);
  });

  it("returns 404 when revoking a session owned by another user (ownership protection)", async () => {
    const alice = await createUser({ email: "alice@example.com" });
    const bob = await createUser({ email: "bob@example.com" });
    const bobLogin = await loginUser(bob.user.email, bob.password);
    const aliceLogin = await loginUser(alice.user.email, alice.password);

    const bobSessions = await api()
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${bobLogin.token}`);
    const bobSessionId = bobSessions.body.sessions[0].id;

    const res = await api()
      .delete(`/api/auth/sessions/${bobSessionId}`)
      .set("Authorization", `Bearer ${aliceLogin.token}`);
    expect(res.status).toBe(404);

    // Bob's session must remain usable
    const me = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${bobLogin.token}`);
    expect(me.status).toBe(200);
  });

  it("returns 404 for a nonexistent session", async () => {
    const { user, password } = await createUser();
    const { token } = await loginUser(user.email, password);
    const res = await api()
      .delete("/api/auth/sessions/999999")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
