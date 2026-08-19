import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/passwords";

describe("password hashing (Argon2id)", () => {
  it("produces a PHC-formatted argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("$m=19456,t=2,p=1$");
  });

  it("never stores the plaintext password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("uses a random salt per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("open-sesame-123");
    await expect(verifyPassword(hash, "open-sesame-123")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("open-sesame-123");
    await expect(verifyPassword(hash, "open-sesame-124")).resolves.toBe(false);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    await expect(verifyPassword("not-a-real-hash", "whatever")).resolves.toBe(
      false,
    );
  });
});
