import { pgTable, bigserial, bigint, text, timestamp, jsonb, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { video_status } from "./enums";
import { usersTable } from "./users";

export const videosTable = pgTable(
  "videos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    owner_id: bigint("owner_id", { mode: "number" }).notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    tags: text("tags").array().notNull().default([]),
    // Binary lives outside PostgreSQL behind the storage abstraction; these
    // columns are filled once the upload completes.
    storage_key: text("storage_key"),
    storage_provider: text("storage_provider"),
    storage_meta: jsonb("storage_meta"),
    mime_type: text("mime_type"),
    original_file_name: text("original_file_name"),
    status: video_status("status").notNull().default("PROCESSING"),
    size_bytes: bigint("size_bytes", { mode: "number" }),
    duration_seconds: numeric("duration_seconds"),
    processing_started_at: timestamp("processing_started_at", { withTimezone: true }),
    pending_review_at: timestamp("pending_review_at", { withTimezone: true }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("videos_idx_owner").on(t.owner_id),
    index("videos_idx_status").on(t.status),
    index("videos_idx_created").on(t.created_at),
  ],
);

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, created_at: true, updated_at: true });

export type InsertVideo = typeof videosTable.$inferInsert;
export type Video = typeof videosTable.$inferSelect;
