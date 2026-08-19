import request from "supertest";
import { sql } from "drizzle-orm";
import { db, sessionsTable, usersTable, type Session, type User } from "@workspace/db";
import app from "../src/app";
import { hashPassword } from "../src/lib/passwords";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "../src/lib/session-token";

export const api = () => request(app);

export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, groups, user_groups, videos, sessions RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;

export interface CreateUserOptions {
  email?: string;
  password?: string;
  role?: User["role"];
  isActive?: boolean;
}

export async function createUser(
  options: CreateUserOptions = {},
): Promise<{ user: User; password: string }> {
  counter += 1;
  const password = options.password ?? "sup3r-secret";
  const email = options.email ?? `user${counter}@example.com`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      password_hash: await hashPassword(password),
      role: options.role ?? "MEMBER",
      is_active: options.isActive ?? true,
    })
    .returning();
  return { user, password };
}

export interface LoginResultBody {
  user: Record<string, unknown>;
  token: string;
  expiresAt?: string;
}

export async function loginUser(
  email: string,
  password: string,
): Promise<LoginResultBody> {
  const res = await api().post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as LoginResultBody;
}

export async function createSessionFor(
  userId: number,
  options: { expiresInMs?: number; revoked?: boolean } = {},
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const now = Date.now();
  const [session] = await db
    .insert(sessionsTable)
    .values({
      user_id: userId,
      session_token_hash: hashSessionToken(token),
      ip_address: "127.0.0.1",
      expires_at: new Date(now + (options.expiresInMs ?? SESSION_TTL_MS)),
      revoked: options.revoked ?? false,
    })
    .returning();
  return { token, session };
}
