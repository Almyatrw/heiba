import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import {
  AdminTerminateSessionParams,
  ListUsersQueryParams,
  ListUsersResponse,
} from "@workspace/api-zod";
import { notFound } from "../lib/errors";
import { revokeSession } from "../lib/sessions";
import { toPublicUser } from "../lib/serializers";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

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
