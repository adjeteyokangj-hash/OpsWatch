import { logger } from "../config/logger";

export const errorHandler = (err: unknown, _req: any, res: any, _next: any) => {
  logger.error(err);
  res.status(500).json({ error: "Internal server error" });
};
