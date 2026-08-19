import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./lib/errors";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS: production deployments are same-origin, so no cross-origin access is
// needed. An explicit ALLOWED_ORIGINS env list can opt back in; in development
// localhost origins are allowed for the Vite dev server.
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true); // same-origin / curl
      if (allowedOrigins.length > 0) {
        return callback(null, allowedOrigins.includes(origin));
      }
      if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// In production the API server also serves the built web app so the whole
// deployment is same-origin (session cookies work without CORS tricks).
// WEB_DIST is the built artifacts/web/dist directory; in dev the Vite
// server serves the frontend and proxies /api, so this block stays inert.
const webDist = process.env.WEB_DIST;
if (webDist && existsSync(path.resolve(webDist, "index.html"))) {
  const root = path.resolve(webDist);
  app.use(express.static(root));
  // SPA fallback: any non-API GET renders the app shell
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(root, "index.html"));
  });
  app.use("/api", notFoundHandler);
} else {
  app.use(notFoundHandler);
}

app.use(errorHandler);

export default app;
