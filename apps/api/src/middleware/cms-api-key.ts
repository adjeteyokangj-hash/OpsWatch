import type { NextFunction, Request, Response } from "express";
import { verifyCmsApiKey } from "../services/cms-content/cms-content.service";

/**
 * Authenticates OkangGroup CMS gateway calls only.
 * Does not grant OpsWatch user sessions, billing, or Command Center access.
 */
export const requireCmsApiKey = async (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("x-api-key") ?? req.header("X-Api-Key");
  const ok = await verifyCmsApiKey(key);
  if (!ok) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized",
      correlation_id: req.header("x-correlation-id") ?? undefined
    });
    return;
  }
  next();
};
