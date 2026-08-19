import { pgTable, bigint, timestamp, text, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { groupsTable } from "./groups";

// Join table between users and groups with a composite primary key to prevent duplicates
export const userGroupsTable = pgTable(
  "user_groups",
  {
    user_id: bigint("user_id", { mode: "number" }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    group_id: bigint("group_id", { mode: "number" }).notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
    role_in_group: text("role_in_group"),
    joined_at: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.group_id] }), index("user_groups_idx_group").on(t.group_id)],
);

export const insertUserGroupSchema = createInsertSchema(userGroupsTable).omit({});

export type InsertUserGroup = typeof userGroupsTable.$inferInsert;
export type UserGroup = typeof userGroupsTable.$inferSelect;
