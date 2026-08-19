import { rateLimit } from "express-rate-limit";

// Brute-force protection for credential endpoints. The limit is configurable
// so test environments can raise it via LOGIN_RATE_LIMIT.
const limit = Number(process.env.LOGIN_RATE_LIMIT ?? 20);

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "RATE_LIMITED",
    message: "Too many login attempts, please try again later.",
  },
});
