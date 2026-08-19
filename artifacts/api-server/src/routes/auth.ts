import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import {
  GetCurrentUserResponse,
  ListMySessionsResponse,
  LoginBody,
  LoginResponse,
  RevokeMySessionParams,
} from "@workspace/api-zod";
import { HttpError, notFound } from "../lib/errors";
import { verifyPassword, hashPassword } from "../lib/passwords";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import {
  createSession,
  listActiveUserSessions,
  revokeAllUserSessions,
  revokeSession,
} from "../lib/sessions";
import { toPublicUser, toSessionInfo } from "../lib/serializers";
import { requireAuth } from "../middlewares/auth";
import { loginRateLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

// Dummy hash so unknown-email logins cost the same Argon2id verification time
// as known-email logins, reducing user-enumeration timing signal.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

function clientIp(req: Request): string {
  return req.ip ?? "0.0.0.0";
}

function authOf(req: Request) {
  if (!req.auth) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.auth;
}

router.post("/login", loginRateLimiter, async (req: Request, res: Response) => {
  const body = LoginBody.parse(req.body);
  const email = body.email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const passwordOk = user
    ? await verifyPassword(user.password_hash, body.password)
    : (await verifyPassword(await getDummyHash(), body.password), false);

  if (!user || !passwordOk) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!user.is_active) {
    throw new HttpError(403, "ACCOUNT_DISABLED", "Account is deactivated");
  }

  const { token, session } = await createSession({
    userId: user.id,
    ipAddress: clientIp(req),
    deviceInfo: req.headers["user-agent"] ?? null,
    deviceId: body.deviceId ?? null,
  });

  setSessionCookie(res, token);
  res.json(
    LoginResponse.parse({
      user: toPublicUser(user),
      token,
      expiresAt: session.expires_at,
    }),
  );
});

router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  const { session } = authOf(req);
  await revokeSession(session.id);
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/logout-all", requireAuth, async (req: Request, res: Response) => {
  const { user } = authOf(req);
  await revokeAllUserSessions(user.id);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const { user, session } = authOf(req);
  res.json(
    GetCurrentUserResponse.parse({
      user: toPublicUser(user),
      session: toSessionInfo(session, session.id),
    }),
  );
});

router.get("/sessions", requireAuth, async (req: Request, res: Response) => {
  const { user, session } = authOf(req);
  const sessions = await listActiveUserSessions(user.id);
  res.json(
    ListMySessionsResponse.parse({
      sessions: sessions.map((s) => toSessionInfo(s, session.id)),
    }),
  );
});

router.delete(
  "/sessions/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = RevokeMySessionParams.parse(req.params);
    const { user, session: current } = authOf(req);

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1);

    // Ownership check: never reveal whether another user's session exists
    if (!session || session.user_id !== user.id) {
      throw notFound("Session not found");
    }

    await revokeSession(session.id);
    if (session.id === current.id) {
      clearSessionCookie(res);
    }
    res.status(204).end();
  },
);

export default router;
