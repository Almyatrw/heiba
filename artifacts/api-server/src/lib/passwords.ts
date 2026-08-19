import { hash, verify } from "@node-rs/argon2";
import type { Algorithm } from "@node-rs/argon2";

// Algorithm.Argon2id === 2. The const enum member cannot be accessed under
// isolatedModules, so we pin the numeric value (it is part of @node-rs/argon2's
// stable public API and matches the PHC identifier "argon2id").
const ARGON2ID = 2 as Algorithm;

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1)
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    // Malformed hash — treat as mismatch, never leak details
    return false;
  }
}
