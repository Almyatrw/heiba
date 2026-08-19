import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import type { AuthContext } from "../types/express";
import { forbidden, unauthorized } from "../lib/errors";
import { SESSION_COOKIE } from "../lib/session-token";
import {
  findSessionByToken,
  isSessionUsable,
  touchSession,
} from "../lib/sessions";

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return req.cookies?.[SESSION_COOKIE] as string | undefined;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) throw unauthorized();

  const session = await findSessionByToken(token);
  if (!session) throw unauthorized("Invalid session");
  if (!isSessionUsable(session)) throw unauthorized("Session expired or revoked");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.user_id))
    .limit(1);
  if (!user) throw unauthorized("Invalid session");
  if (!user.is_active) throw forbidden("Account is deactivated");

  req.auth = { user, session } satisfies AuthContext;
  await touchSession(session);
  next();
}

export function requireRole(...roles: User["role"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    if (!roles.includes(auth.user.role)) {
      throw forbidden("This operation requires a higher privilege level");
    }
    next();
  };
}
