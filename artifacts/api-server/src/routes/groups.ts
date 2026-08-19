import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  db,
  groupsTable,
  userGroupsTable,
  usersTable,
  type Group,
  type User,
  type UserGroup,
} from "@workspace/db";
import {
  AddGroupMemberBody,
  AddGroupMemberParams,
  AddGroupMemberResponse,
  CreateGroupBody,
  CreateGroupResponse,
  DeleteGroupParams,
  GetGroupParams,
  GetGroupResponse,
  ListGroupMembersParams,
  ListGroupMembersResponse,
  ListGroupsQueryParams,
  ListGroupsResponse,
  RemoveGroupMemberParams,
  UpdateGroupBody,
  UpdateGroupMemberBody,
  UpdateGroupMemberParams,
  UpdateGroupMemberResponse,
  UpdateGroupParams,
  UpdateGroupResponse,
} from "@workspace/api-zod";
import { conflict, forbidden, notFound } from "../lib/errors";
import { toGroup, toGroupMember } from "../lib/serializers";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

function isAdmin(user: User) {
  return user.role === "OWNER" || user.role === "ADMIN";
}

async function getGroupOr404(id: number): Promise<Group> {
  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, id))
    .limit(1);
  if (!group) throw notFound("Group not found");
  return group;
}

async function getMembership(
  groupId: number,
  userId: number,
): Promise<UserGroup | undefined> {
  const [membership] = await db
    .select()
    .from(userGroupsTable)
    .where(
      and(
        eq(userGroupsTable.group_id, groupId),
        eq(userGroupsTable.user_id, userId),
      ),
    )
    .limit(1);
  return membership;
}

function isGroupManager(user: User, membership: UserGroup | undefined) {
  return membership?.role_in_group === "manager";
}

// Visibility: OWNER/ADMIN see everything; others only groups they belong to.
async function assertGroupVisible(user: User, groupId: number) {
  if (isAdmin(user)) return undefined;
  const membership = await getMembership(groupId, user.id);
  if (!membership) throw notFound("Group not found");
  return membership;
}

// Management of members: OWNER/ADMIN anywhere, group managers only inside
// groups where their membership role is "manager".
async function assertCanManageMembers(user: User, groupId: number) {
  if (isAdmin(user)) return undefined;
  const membership = await getMembership(groupId, user.id);
  if (!isGroupManager(user, membership)) {
    throw membership ? forbidden() : notFound("Group not found");
  }
  return membership;
}

async function memberCounts(
  groupIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (groupIds.length === 0) return map;
  const rows = await db
    .select({ groupId: userGroupsTable.group_id, value: count() })
    .from(userGroupsTable)
    .where(inArray(userGroupsTable.group_id, groupIds))
    .groupBy(userGroupsTable.group_id);
  for (const row of rows) map.set(row.groupId, row.value);
  return map;
}

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const query = ListGroupsQueryParams.parse(req.query);
  const user = req.auth!.user;

  let scopedIds: number[] | null = null;
  if (!isAdmin(user)) {
    const memberships = await db
      .select()
      .from(userGroupsTable)
      .where(eq(userGroupsTable.user_id, user.id));
    scopedIds = memberships
      .filter((m) => user.role !== "GROUP_MANAGER" || m.role_in_group === "manager")
      .map((m) => m.group_id);
  }

  const conditions = scopedIds ? [inArray(groupsTable.id, scopedIds)] : [];
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(groupsTable)
      .where(and(...conditions))
      .orderBy(asc(groupsTable.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(groupsTable).where(and(...conditions)),
  ]);

  const counts = await memberCounts(rows.map((g) => g.id));
  res.json(
    ListGroupsResponse.parse({
      groups: rows.map((g) => toGroup(g, counts.get(g.id) ?? 0)),
      total: totalRow?.value ?? 0,
    }),
  );
});

router.post(
  "/",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const body = CreateGroupBody.parse(req.body);
    const user = req.auth!.user;

    const [duplicate] = await db
      .select({ id: groupsTable.id })
      .from(groupsTable)
      .where(
        and(eq(groupsTable.owner_id, user.id), eq(groupsTable.name, body.name)),
      )
      .limit(1);
    if (duplicate) throw conflict("A group with this name already exists");

    const [group] = await db
      .insert(groupsTable)
      .values({
        name: body.name,
        description: body.description ?? null,
        owner_id: user.id,
      })
      .returning();
    res.status(201).json(CreateGroupResponse.parse(toGroup(group, 0)));
  },
);

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const { id } = GetGroupParams.parse(req.params);
  const group = await getGroupOr404(id);
  await assertGroupVisible(req.auth!.user, id);
  const counts = await memberCounts([id]);
  res.json(GetGroupResponse.parse(toGroup(group, counts.get(id) ?? 0)));
});

router.patch(
  "/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = UpdateGroupParams.parse(req.params);
    const body = UpdateGroupBody.parse(req.body);
    const group = await getGroupOr404(id);

    if (body.name !== undefined && body.name !== group.name) {
      const [duplicate] = await db
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .where(
          and(
            eq(groupsTable.owner_id, group.owner_id),
            eq(groupsTable.name, body.name),
          ),
        )
        .limit(1);
      if (duplicate) throw conflict("A group with this name already exists");
    }

    const [updated] = await db
      .update(groupsTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        updated_at: new Date(),
      })
      .where(eq(groupsTable.id, id))
      .returning();
    const counts = await memberCounts([id]);
    res.json(UpdateGroupResponse.parse(toGroup(updated, counts.get(id) ?? 0)));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = DeleteGroupParams.parse(req.params);
    await getGroupOr404(id);
    await db.delete(groupsTable).where(eq(groupsTable.id, id));
    res.status(204).end();
  },
);

router.get(
  "/:id/members",
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = ListGroupMembersParams.parse(req.params);
    await getGroupOr404(id);
    await assertGroupVisible(req.auth!.user, id);

    const rows = await db
      .select({ membership: userGroupsTable, user: usersTable })
      .from(userGroupsTable)
      .innerJoin(usersTable, eq(usersTable.id, userGroupsTable.user_id))
      .where(eq(userGroupsTable.group_id, id))
      .orderBy(asc(usersTable.id));
    res.json(
      ListGroupMembersResponse.parse({
        members: rows.map((r) => toGroupMember(r.membership, r.user)),
      }),
    );
  },
);

router.post(
  "/:id/members",
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = AddGroupMemberParams.parse(req.params);
    const body = AddGroupMemberBody.parse(req.body);
    const user = req.auth!.user;
    await getGroupOr404(id);
    const requesterMembership = await assertCanManageMembers(user, id);

    // Managers cannot create other managers — that requires OWNER/ADMIN.
    if (body.roleInGroup === "manager" && !isAdmin(user)) {
      throw forbidden("Only OWNER/ADMIN can assign group managers");
    }
    void requesterMembership;

    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, body.userId))
      .limit(1);
    if (!target) throw notFound("User not found");

    if (await getMembership(id, body.userId)) {
      throw conflict("User is already a member of this group");
    }

    const [membership] = await db
      .insert(userGroupsTable)
      .values({
        group_id: id,
        user_id: body.userId,
        role_in_group: body.roleInGroup ?? "member",
      })
      .returning();
    res
      .status(201)
      .json(AddGroupMemberResponse.parse(toGroupMember(membership, target)));
  },
);

router.patch(
  "/:id/members/:userId",
  requireAuth,
  async (req: Request, res: Response) => {
    const { id, userId } = UpdateGroupMemberParams.parse(req.params);
    const body = UpdateGroupMemberBody.parse(req.body);
    const user = req.auth!.user;
    await getGroupOr404(id);
    await assertCanManageMembers(user, id);

    const membership = await getMembership(id, userId);
    if (!membership) throw notFound("Membership not found");

    const touchesManager =
      body.roleInGroup === "manager" || membership.role_in_group === "manager";
    if (touchesManager && !isAdmin(user)) {
      throw forbidden("Only OWNER/ADMIN can manage group managers");
    }

    const [updated] = await db
      .update(userGroupsTable)
      .set({ role_in_group: body.roleInGroup })
      .where(
        and(
          eq(userGroupsTable.group_id, id),
          eq(userGroupsTable.user_id, userId),
        ),
      )
      .returning();
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    res.json(
      UpdateGroupMemberResponse.parse(toGroupMember(updated, target)),
    );
  },
);

router.delete(
  "/:id/members/:userId",
  requireAuth,
  async (req: Request, res: Response) => {
    const { id, userId } = RemoveGroupMemberParams.parse(req.params);
    const user = req.auth!.user;
    await getGroupOr404(id);
    await assertCanManageMembers(user, id);

    const membership = await getMembership(id, userId);
    if (!membership) throw notFound("Membership not found");
    if (membership.role_in_group === "manager" && !isAdmin(user)) {
      throw forbidden("Only OWNER/ADMIN can remove group managers");
    }

    await db
      .delete(userGroupsTable)
      .where(
        and(
          eq(userGroupsTable.group_id, id),
          eq(userGroupsTable.user_id, userId),
        ),
      );
    res.status(204).end();
  },
);

export default router;
