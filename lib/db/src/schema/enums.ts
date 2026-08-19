import { pgEnum } from "drizzle-orm/pg-core";

// Database-level enums
export const user_role = pgEnum("user_role", ["OWNER", "ADMIN", "GROUP_MANAGER", "MEMBER"]);
export const video_status = pgEnum("video_status", [
  "PROCESSING",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "PRIVATE",
  "ARCHIVED",
  "FAILED",
]);
export const review_action = pgEnum("review_action", ["APPROVED", "REJECTED"]);
export const group_role = pgEnum("group_role", ["manager", "member"]);
