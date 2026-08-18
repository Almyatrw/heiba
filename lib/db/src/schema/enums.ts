import { pgEnum } from "drizzle-orm/pg-core";

// Database-level enums
export const user_role = pgEnum("user_role", ["OWNER", "ADMIN", "MEMBER"]);
export const video_status = pgEnum("video_status", ["PROCESSING", "PENDING_REVIEW", "APPROVED", "REJECTED"]);
