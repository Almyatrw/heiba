import type { Session, User } from "@workspace/db";

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
