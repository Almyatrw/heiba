import { pgTable, bigint, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { categoriesTable } from "./categories";
import { videosTable } from "./videos";

export const videoCategoriesTable = pgTable(
  "video_categories",
  {
    video_id: bigint("video_id", { mode: "number" }).notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    category_id: bigint("category_id", { mode: "number" }).notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.video_id, t.category_id] }), index("video_categories_idx_category").on(t.category_id)],
);

export const insertVideoCategorySchema = createInsertSchema(videoCategoriesTable).omit({});

export type InsertVideoCategory = typeof videoCategoriesTable.$inferInsert;
export type VideoCategory = typeof videoCategoriesTable.$inferSelect;
