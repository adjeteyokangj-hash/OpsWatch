import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

/** Constant-time string comparison that does not leak length via early return. */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison of equal-length buffers to avoid timing leaks.
    timingSafeEqual(bufferA, Buffer.alloc(bufferA.length));
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
};

const extractBearerToken = (header: string | undefined): string | null => {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
};

/**
 * Authenticate Supabase-Cron requests to the serverless worker tick endpoint.
 *
 * Requires `Authorization: Bearer <OPSWATCH_CRON_SECRET>` and compares in
 * constant time. Fails closed: if `OPSWATCH_CRON_SECRET` is unset on the
 * server, every request is rejected with 401.
 */
export const requireCronSecret = (req: Request, res: Response, next: NextFunction): void => {
  const configured = process.env.OPSWATCH_CRON_SECRET?.trim();
  if (!configured) {
    res.status(401).json({ error: "Cron secret is not configured" });
    return;
  }

  const provided = extractBearerToken(req.header("authorization"));
  if (!provided || !constantTimeEqual(provided, configured)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};
