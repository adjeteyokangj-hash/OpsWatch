import { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";
import {
  verifyGitHubWebhookSignature,
  verifyRenderWebhookSignature,
  verifyVercelWebhookSignature
} from "../lib/request-signature";

export type WebhookRequest = Request & { rawBody?: Buffer };

export type WebhookProvider = "vercel" | "github" | "render";

type WebhookAuthConfig = {
  provider: WebhookProvider;
  secretEnvVar: "VERCEL_WEBHOOK_SECRET" | "GITHUB_WEBHOOK_SECRET" | "RENDER_WEBHOOK_SECRET";
  signatureHeader: string;
};

const WEBHOOK_AUTH_CONFIG: Record<WebhookProvider, WebhookAuthConfig> = {
  vercel: {
    provider: "vercel",
    secretEnvVar: "VERCEL_WEBHOOK_SECRET",
    signatureHeader: "x-vercel-signature"
  },
  github: {
    provider: "github",
    secretEnvVar: "GITHUB_WEBHOOK_SECRET",
    signatureHeader: "x-hub-signature-256"
  },
  render: {
    provider: "render",
    secretEnvVar: "RENDER_WEBHOOK_SECRET",
    signatureHeader: "webhook-signature"
  }
};

const auditWebhookRejection = (
  provider: WebhookProvider,
  reason: "secret_missing" | "signature_missing" | "body_missing" | "signature_invalid",
  req: Request
): void => {
  logger.warn("webhook-auth: rejected request", {
    provider,
    reason,
    requestId: req.header("x-request-id"),
    ip: req.ip
  });
};

const verifyProviderSignature = (provider: WebhookProvider, secret: string, req: WebhookRequest): boolean => {
  const rawBody = req.rawBody;
  if (!rawBody || rawBody.length === 0) {
    return false;
  }

  if (provider === "vercel") {
    const signature = req.header("x-vercel-signature") || "";
    return verifyVercelWebhookSignature(secret, rawBody, signature);
  }

  if (provider === "github") {
    const signature = req.header("x-hub-signature-256") || "";
    return verifyGitHubWebhookSignature(secret, rawBody, signature);
  }

  return verifyRenderWebhookSignature(secret, rawBody, {
    webhookId: req.header("webhook-id"),
    webhookTimestamp: req.header("webhook-timestamp"),
    webhookSignature: req.header("webhook-signature")
  });
};

export const requireWebhookSignature = (provider: WebhookProvider) => {
  const config = WEBHOOK_AUTH_CONFIG[provider];

  return (req: Request, res: Response, next: NextFunction): void => {
    const webhookReq = req as WebhookRequest;
    const secret = process.env[config.secretEnvVar]?.trim();
    if (!secret) {
      auditWebhookRejection(provider, "secret_missing", req);
      res.status(503).json({ error: "Webhook verification is not configured" });
      return;
    }

    if (!webhookReq.rawBody || webhookReq.rawBody.length === 0) {
      auditWebhookRejection(provider, "body_missing", req);
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const signaturePresent =
      provider === "render"
        ? Boolean(req.header("webhook-id") && req.header("webhook-timestamp") && req.header("webhook-signature"))
        : Boolean(req.header(config.signatureHeader));

    if (!signaturePresent) {
      auditWebhookRejection(provider, "signature_missing", req);
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }

    if (!verifyProviderSignature(provider, secret, webhookReq)) {
      auditWebhookRejection(provider, "signature_invalid", req);
      res.status(401).json({ error: `Invalid ${provider} webhook signature` });
      return;
    }

    next();
  };
};
