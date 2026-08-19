import { and, eq, gt, ne } from "drizzle-orm";
import { db, sessionsTable, type Session } from "@workspace/db";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "./session-token";

export interface CreateSessionInput {
  userId: number;
  ipAddress: string;
  deviceInfo?: string | null;
  deviceId?: string | null;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const now = new Date();
  const [session] = await db
    .insert(sessionsTable)
    .values({
      user_id: input.userId,
      session_token_hash: hashSessionToken(token),
      device_id: input.deviceId ?? null,
      device_info: input.deviceInfo ?? null,
      ip_address: input.ipAddress,
      created_at: now,
      last_used_at: now,
      expires_at: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();
  return { token, session };
}

export async function findSessionByToken(
  token: string,
): Promise<Session | undefined> {
  const hash = hashSessionToken(token);
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.session_token_hash, hash))
    .limit(1);
  return session;
}

export function isSessionUsable(session: Session, now = new Date()): boolean {
  if (session.revoked) return false;
  if (session.expires_at && session.expires_at.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

const LAST_USED_UPDATE_THRESHOLD_MS = 60 * 1000;

export async function touchSession(
  session: Session,
  now = new Date(),
): Promise<void> {
  if (
    session.last_used_at &&
    now.getTime() - session.last_used_at.getTime() < LAST_USED_UPDATE_THRESHOLD_MS
  ) {
    return;
  }
  await db
    .update(sessionsTable)
    .set({ last_used_at: now })
    .where(eq(sessionsTable.id, session.id));
}

export async function revokeSession(
  sessionId: number,
  now = new Date(),
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ revoked: true, revoked_at: now })
    .where(eq(sessionsTable.id, sessionId));
}

export async function revokeAllUserSessions(
  userId: number,
  exceptSessionId?: number,
  now = new Date(),
): Promise<void> {
  const conditions = [
    eq(sessionsTable.user_id, userId),
    eq(sessionsTable.revoked, false),
  ];
  if (exceptSessionId !== undefined) {
    conditions.push(ne(sessionsTable.id, exceptSessionId));
  }
  await db
    .update(sessionsTable)
    .set({ revoked: true, revoked_at: now })
    .where(and(...conditions));
}

export async function listActiveUserSessions(
  userId: number,
  now = new Date(),
): Promise<Session[]> {
  return db
    .select()
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.user_id, userId),
        eq(sessionsTable.revoked, false),
        gt(sessionsTable.expires_at, now),
      ),
    )
    .orderBy(sessionsTable.created_at);
}
