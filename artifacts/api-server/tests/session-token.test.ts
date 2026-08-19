import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  sessionTokenMatches,
} from "../src/lib/session-token";

describe("session tokens", () => {
  it("generates high-entropy unique tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically to a 64-char hex digest", () => {
    const token = generateSessionToken();
    const h1 = hashSessionToken(token);
    const h2 = hashSessionToken(token);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("never equals the raw token", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it("matches the correct token and rejects others", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(sessionTokenMatches(token, hash)).toBe(true);
    expect(sessionTokenMatches(generateSessionToken(), hash)).toBe(false);
  });
});
