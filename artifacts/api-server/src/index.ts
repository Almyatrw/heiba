import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Minimal health endpoint. We intentionally do not import generated Zod schemas here
// to avoid depending on Orval outputs that are not yet generated.
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
