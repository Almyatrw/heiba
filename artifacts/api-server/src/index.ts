import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { HealthCheckResponse } from "@workspace/api-zod";

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Minimal health endpoint validated by generated Zod schema (if present)
app.get("/api/healthz", (_req, res) => {
  const payload = { status: "ok" };
  // Validate payload using generated schema; if schema parse throws, return 500
  try {
    const parsed = HealthCheckResponse.parse(payload);
    res.json(parsed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Health check validation failed:", err);
    res.status(500).json({ error: "schema validation failed" });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
