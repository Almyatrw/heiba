import { pgTable, bigint, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { video_upload_status } from "./enums";
import { videosTable } from "./videos";

// Tracks direct (browser → object storage) upload jobs. The application
// server never proxies large video binaries in production: it issues
// presigned URLs, the browser uploads parts straight to R2, and the job row
// records the lifecycle (initiated → completed | aborted) so abandoned
// multipart uploads can be cleaned up.
export const videoUploadsTable = pgTable(
  "video_uploads",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    video_id: bigint("video_id", { mode: "number" }).notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    storage_key: text("storage_key").notNull(),
    // Provider-side multipart upload id (R2/S3). Null for single-PUT uploads.
    provider_upload_id: text("provider_upload_id"),
    status: video_upload_status("status").notNull().default("INITIATED"),
    part_count: integer("part_count").notNull().default(1),
    declared_size_bytes: bigint("declared_size_bytes", { mode: "number" }),
    file_name: text("file_name"),
    mime_type: text("mime_type"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("video_uploads_idx_video").on(t.video_id),
    index("video_uploads_idx_status_expires").on(t.status, t.expires_at),
  ],
);

export type InsertVideoUpload = typeof videoUploadsTable.$inferInsert;
export type VideoUpload = typeof videoUploadsTable.$inferSelect;
