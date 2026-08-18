import { pgTable, bigserial, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { user_role } from "./enums";

export const usersTable = pgTable(
  "users",
  {
    id: bigserial("id").primaryKey(),
    email: text("email").notNull(),
    password_hash: text("password_hash").notNull(),
    role: user_role("role").notNull().default("MEMBER"),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique_email: uniqueIndex(t.email),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertUser = typeof insertUserSchema._type;
export type User = typeof usersTable.$inferSelect;
