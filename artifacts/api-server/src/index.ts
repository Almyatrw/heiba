import app from "./app";
import { logger } from "./lib/logger";

const port = process.env.PORT ? Number(process.env.PORT) : 5000;

app.listen(port, () => {
  logger.info(`API server listening on http://localhost:${port}`);
});
