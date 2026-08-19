import { pgTable, bigserial, text, bigint, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const groupsTable = pgTable(
  "groups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    owner_id: bigint("owner_id", { mode: "number" }).notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("groups_unique_owner_name").on(t.owner_id, t.name), index("groups_idx_owner").on(t.owner_id)],
);

export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertGroup = typeof groupsTable.$inferInsert;
export type Group = typeof groupsTable.$inferSelect;
