import { pgTable, bigserial, bigint, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { video_status } from "./enums";
import { usersTable } from "./users";
import { numeric } from "drizzle-orm/pg-core";

export const videosTable = pgTable(
  "videos",
  {
    id: bigserial("id").primaryKey(),
    owner_id: bigint("owner_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    title: text("title"),
    description: text("description"),
    storage_key: text("storage_key").notNull(),
    storage_provider: text("storage_provider").notNull(),
    storage_meta: jsonb("storage_meta"),
    status: video_status("status").notNull().default("PROCESSING"),
    size_bytes: bigint("size_bytes"),
    duration_seconds: numeric("duration_seconds"),
    processing_started_at: timestamp("processing_started_at", { withTimezone: true }),
    pending_review_at: timestamp("pending_review_at", { withTimezone: true }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idx_owner: index(t.owner_id),
    idx_status: index(t.status),
    idx_created: index(t.created_at),
  }),
);

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertVideo = typeof insertVideoSchema._type;
export type Video = typeof videosTable.$inferSelect;
