import { pgTable, bigserial, bigint, text, timestamp, boolean, inet, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const sessionsTable = pgTable(
  "sessions",
  {
    id: bigserial("id").primaryKey(),
    session_token_hash: text("session_token_hash").notNull(),
    user_id: bigint("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    device_id: text("device_id"),
    device_info: text("device_info"),
    ip_address: inet("ip_address"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    revoked: boolean("revoked").notNull().default(false),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    unique_token: uniqueIndex(t.session_token_hash),
    idx_user: index(t.user_id),
  }),
);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, created_at: true });

export type InsertSession = typeof insertSessionSchema._type;
export type Session = typeof sessionsTable.$inferSelect;
