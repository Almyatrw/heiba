import type { Session, User } from "@workspace/db";

export interface AuthContext {
  user: User;
  session: Session;
}

// NOTE: augmenting "express-serve-static-core" does not resolve under pnpm's
// strict node_modules layout, so we augment the "express" module directly.
declare module "express" {
  interface Request {
    auth?: AuthContext;
  }
}
