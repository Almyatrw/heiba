import type {
  Category,
  Group,
  Session,
  User,
  UserGroup,
  Video,
  VideoReview,
} from "@workspace/db";

// Public wire shapes — must never leak password_hash or session_token_hash.

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}

export function toSessionInfo(session: Session, currentSessionId?: number) {
  return {
    id: session.id,
    deviceId: session.device_id,
    deviceInfo: session.device_info,
    ipAddress: String(session.ip_address),
    createdAt: session.created_at,
    lastUsedAt: session.last_used_at,
    expiresAt: session.expires_at,
    revoked: session.revoked,
    current: currentSessionId !== undefined && session.id === currentSessionId,
  };
}

export function toCategory(category: Category) {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    createdAt: category.created_at,
  };
}

export function toGroup(group: Group, memberCount: number) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    ownerId: group.owner_id,
    memberCount,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}

export function toGroupMember(membership: UserGroup, user: User) {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    roleInGroup: membership.role_in_group,
    joinedAt: membership.joined_at,
  };
}

export function toAdminVideo(
  video: Video,
  categoryIds: number[],
  groupIds: number[],
) {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    tags: video.tags,
    status: video.status,
    durationSeconds:
      video.duration_seconds === null ? null : Number(video.duration_seconds),
    mimeType: video.mime_type,
    sizeBytes: video.size_bytes,
    originalFileName: video.original_file_name,
    storageProvider: video.storage_provider,
    uploadedBy: video.owner_id,
    categoryIds,
    groupIds,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
  };
}

export function toReviewRecord(review: VideoReview) {
  return {
    id: review.id,
    videoId: review.video_id,
    reviewerId: review.reviewer_id,
    action: review.action,
    notes: review.notes,
    createdAt: review.created_at,
  };
}
