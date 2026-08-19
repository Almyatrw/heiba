import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, eq } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";
import {
  AdminTerminateSessionParams,
  CreateUserBody,
  CreateUserResponse,
  DeactivateUserParams,
  ListUsersQueryParams,
  ListUsersResponse,
  UpdateUserBody,
  UpdateUserParams,
  UpdateUserResponse,
} from "@workspace/api-zod";
import { conflict, forbidden, notFound } from "../lib/errors";
import { hashPassword } from "../lib/passwords";
import { revokeAllUserSessions, revokeSession } from "../lib/sessions";
import { toPublicUser } from "../lib/serializers";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

function isPrivilegedRole(role: User["role"]) {
  return role === "OWNER" || role === "ADMIN";
}

async function getUserOr404(id: number): Promise<User> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!user) throw notFound("User not found");
  return user;
}

// Role hierarchy enforcement: only the OWNER manages OWNER/ADMIN accounts
// (spec: "Owner creates and manages admins"). Admins manage GROUP_MANAGER and
// MEMBER accounts only. Nobody can demote or deactivate themselves.
function assertCanTouchTarget(requester: User, target: User) {
  if (target.id === requester.id) {
    throw forbidden("You cannot modify your own account");
  }
  if (requester.role !== "OWNER" && isPrivilegedRole(target.role)) {
    throw forbidden("Only the owner can manage admin accounts");
  }
}

function assertCanAssignRole(requester: User, role: User["role"]) {
  if (requester.role !== "OWNER" && isPrivilegedRole(role)) {
    throw forbidden("Only the owner can grant admin roles");
  }
}

// User listing is available to OWNER and ADMIN; role comes only from the
// server-side session, never from client input.
router.get(
  "/users",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const query = ListUsersQueryParams.parse(req.query);
    const conditions = query.role ? [eq(usersTable.role, query.role)] : [];

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(usersTable)
        .where(and(...conditions))
        .orderBy(asc(usersTable.id))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ value: count() }).from(usersTable).where(and(...conditions)),
    ]);

    res.json(
      ListUsersResponse.parse({
        users: rows.map(toPublicUser),
        total: totalRow?.value ?? 0,
      }),
    );
  },
);

router.post(
  "/users",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const body = CreateUserBody.parse(req.body);
    const requester = req.auth!.user;
    assertCanAssignRole(requester, body.role);

    const email = body.email.toLowerCase();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) throw conflict("Email already in use");

    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        password_hash: await hashPassword(body.password),
        role: body.role,
        is_active: body.isActive ?? true,
      })
      .returning();
    res.status(201).json(CreateUserResponse.parse(toPublicUser(user)));
  },
);

router.patch(
  "/users/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = UpdateUserParams.parse(req.params);
    const body = UpdateUserBody.parse(req.body);
    const requester = req.auth!.user;
    const target = await getUserOr404(id);

    assertCanTouchTarget(requester, target);
    if (body.role !== undefined) assertCanAssignRole(requester, body.role);

    const [user] = await db
      .update(usersTable)
      .set({
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { is_active: body.isActive } : {}),
      })
      .where(eq(usersTable.id, id))
      .returning();

    // Deactivation must immediately cut access
    if (body.isActive === false) await revokeAllUserSessions(id);

    res.json(UpdateUserResponse.parse(toPublicUser(user)));
  },
);

router.delete(
  "/users/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = DeactivateUserParams.parse(req.params);
    const requester = req.auth!.user;
    const target = await getUserOr404(id);
    assertCanTouchTarget(requester, target);

    await db
      .update(usersTable)
      .set({ is_active: false })
      .where(eq(usersTable.id, id));
    await revokeAllUserSessions(id);
    res.status(204).end();
  },
);

// Terminating arbitrary sessions is an OWNER-only power (spec: the owner can
// terminate suspicious sessions; admins do not inherit owner permissions).
router.delete(
  "/sessions/:id",
  requireAuth,
  requireRole("OWNER"),
  async (req: Request, res: Response) => {
    const { id } = AdminTerminateSessionParams.parse(req.params);
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1);
    if (!session) throw notFound("Session not found");
    await revokeSession(session.id);
    res.status(204).end();
  },
);

export default router;
