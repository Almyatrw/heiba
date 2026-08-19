import { pgTable, bigserial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const categoriesTable = pgTable("categories", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertCategory = typeof categoriesTable.$inferInsert;
export type Category = typeof categoriesTable.$inferSelect;
