import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import {
  disconnectPlatformStripeSettings,
  getPlatformStripeSettings,
  listLegacyProjectStripeIntegrations,
  savePlatformStripeSettings,
  validatePlatformStripeSettings
} from "../services/billing/platform-stripe-settings.service";

const saveSchema = z.object({
  publishableKey: z.string().max(255).nullable().optional(),
  secretKey: z.string().max(255).nullable().optional(),
  webhookSecret: z.string().max(255).nullable().optional(),
  apiBase: z.string().url().optional()
});

export const getPlatformStripe = async (_req: AuthRequest, res: Response) => {
  const settings = await getPlatformStripeSettings();
  res.json(settings);
};

export const savePlatformStripe = async (req: AuthRequest, res: Response) => {
  try {
    const body = saveSchema.parse(req.body ?? {});
    const settings = await savePlatformStripeSettings({
      publishableKey: body.publishableKey,
      secretKey: body.secretKey,
      webhookSecret: body.webhookSecret,
      apiBase: body.apiBase
    });
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.flatten() });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to save Stripe settings" });
  }
};

export const validatePlatformStripe = async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await validatePlatformStripeSettings();
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Stripe validation failed" });
  }
};

export const disconnectPlatformStripe = async (_req: AuthRequest, res: Response) => {
  const settings = await disconnectPlatformStripeSettings();
  res.json(settings);
};

export const getLegacyProjectStripeIntegrations = async (_req: AuthRequest, res: Response) => {
  const rows = await listLegacyProjectStripeIntegrations();
  res.json({ count: rows.length, integrations: rows });
};
