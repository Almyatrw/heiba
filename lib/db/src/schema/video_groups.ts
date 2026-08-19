import { pgTable, bigint, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { groupsTable } from "./groups";
import { videosTable } from "./videos";

// Videos are visible only to members of the assigned groups. A video with no
// group assignment stays private (owner/admin only).
export const videoGroupsTable = pgTable(
  "video_groups",
  {
    video_id: bigint("video_id", { mode: "number" }).notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    group_id: bigint("group_id", { mode: "number" }).notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.video_id, t.group_id] }), index("video_groups_idx_group").on(t.group_id)],
);

export const insertVideoGroupSchema = createInsertSchema(videoGroupsTable).omit({});

export type InsertVideoGroup = typeof videoGroupsTable.$inferInsert;
export type VideoGroup = typeof videoGroupsTable.$inferSelect;
