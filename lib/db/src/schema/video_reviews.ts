import { pgTable, bigserial, bigint, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { review_action } from "./enums";
import { usersTable } from "./users";
import { videosTable } from "./videos";

// Manual review records — the platform intentionally has NO automatic
// moderation; every status transition is a human decision stored here.
export const videoReviewsTable = pgTable(
  "video_reviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    video_id: bigint("video_id", { mode: "number" }).notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    reviewer_id: bigint("reviewer_id", { mode: "number" }).notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    action: review_action("action").notNull(),
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("video_reviews_idx_video").on(t.video_id), index("video_reviews_idx_created").on(t.created_at)],
);

export const insertVideoReviewSchema = createInsertSchema(videoReviewsTable).omit({ id: true, created_at: true });

export type InsertVideoReview = typeof videoReviewsTable.$inferInsert;
export type VideoReview = typeof videoReviewsTable.$inferSelect;
