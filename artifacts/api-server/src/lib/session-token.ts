import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Secret used to HMAC session tokens before storage. In production it MUST
// come from the environment; in development we fall back to a per-process
// random secret (which simply invalidates sessions on restart).
const isProduction = process.env.NODE_ENV === "production";

const envSecret = process.env.SESSION_SECRET;
if (isProduction && !envSecret) {
  throw new Error("SESSION_SECRET must be set in production");
}

const sessionSecret = envSecret ?? randomBytes(32).toString("hex");

export const SESSION_COOKIE = "heiba_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", sessionSecret).update(token).digest("hex");
}

export function sessionTokenMatches(token: string, hash: string): boolean {
  const computed = Buffer.from(hashSessionToken(token), "utf8");
  const given = Buffer.from(hash, "utf8");
  return computed.length === given.length && timingSafeEqual(computed, given);
}
