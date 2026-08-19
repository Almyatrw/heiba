import app from "./app";
import { bootstrapOwner } from "./lib/bootstrap";
import { logger } from "./lib/logger";

const port = process.env.PORT ? Number(process.env.PORT) : 5000;

await bootstrapOwner();

app.listen(port, () => {
  logger.info(`API server listening on http://localhost:${port}`);
});
