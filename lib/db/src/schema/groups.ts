import { pgTable, bigserial, text, bigint, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const groupsTable = pgTable(
  "groups",
  {
    id: bigserial("id").primaryKey(),
    name: text("name").notNull(),
    owner_id: bigint("owner_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_owner_name: uniqueIndex(t.owner_id, t.name),
    idx_owner: index(t.owner_id),
  }),
);

export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertGroup = typeof insertGroupSchema._type;
export type Group = typeof groupsTable.$inferSelect;
