import { logger } from "../config/logger";

export const errorHandler = (err: unknown, req: any, res: any, _next: any) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(err);
  console.error("API_ERROR", {
    method: req?.method,
    path: req?.originalUrl || req?.url,
    message
  });
  res.status(500).json({ error: "Internal server error" });
};
