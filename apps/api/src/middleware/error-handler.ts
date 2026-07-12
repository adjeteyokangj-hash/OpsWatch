import { logger } from "../config/logger";
import { isEntitlementError } from "../services/entitlements/entitlement.service";
import { ZodError } from "zod";

export const errorHandler = (err: unknown, req: any, res: any, _next: any) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: err.flatten() });
    return;
  }

  if (isEntitlementError(err)) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error(err);
  console.error("API_ERROR", {
    method: req?.method,
    path: req?.originalUrl || req?.url,
    message
  });
  res.status(500).json({ error: "Internal server error" });
};
