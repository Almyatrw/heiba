import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "./passwords";
import { logger } from "./logger";

// Bootstraps the initial OWNER account from environment variables so a fresh
// deployment can get its first administrator without any public registration
// endpoint. No-op unless both OWNER_EMAIL and OWNER_PASSWORD are set.
export async function bootstrapOwner(): Promise<void> {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;

  if (password.length < 8) {
    throw new Error("OWNER_PASSWORD must be at least 8 characters");
  }

  const passwordHash = await hashPassword(password);
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(usersTable)
      .set({ password_hash: passwordHash, role: "OWNER", is_active: true, updated_at: new Date() })
      .where(eq(usersTable.id, existing.id));
    logger.info({ email }, "owner account updated from environment");
  } else {
    await db.insert(usersTable).values({
      email,
      password_hash: passwordHash,
      role: "OWNER",
    });
    logger.info({ email }, "owner account created from environment");
  }
}
