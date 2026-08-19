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
app.use(cors({ origin: true, credentials: true }));
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
