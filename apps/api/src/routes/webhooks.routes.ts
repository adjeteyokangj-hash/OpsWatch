import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { requireWebhookSignature, type WebhookRequest } from "../middleware/webhook-auth";
import { logger } from "../config/logger";
import {
  constructStripeEvent,
  handleStripeEvent,
  isStripeConfiguredSync
} from "../services/billing/stripe.service";
import { resolvePlatformWebhookSecret } from "../services/billing/platform-stripe-settings.service";

export const webhooksRouter = Router();

webhooksRouter.post("/stripe", async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = (await resolvePlatformWebhookSecret()) ?? process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!isStripeConfiguredSync() && !webhookSecret) {
    res.status(503).json({ error: "Stripe billing is not configured." });
    return;
  }

  const signature = req.header("stripe-signature");
  const rawBody = (req as WebhookRequest).rawBody;
  if (!signature || !rawBody || rawBody.length === 0) {
    res.status(400).json({ error: "Missing Stripe signature or body" });
    return;
  }

  let event;
  try {
    event = await constructStripeEvent(rawBody, signature);
  } catch (error) {
    logger.warn("Stripe webhook signature verification failed", { error: String(error) });
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    logger.error("Stripe webhook handling failed", { error: String(error), type: event.type });
    const status =
      error instanceof Error && error.name === "StripeWebhookProcessingError" ? 400 : 500;
    res.status(status).json({ error: "Webhook handling failed" });
    return;
  }

  res.status(200).json({ received: true });
});

const findProjectByIntegrationId = async (field: "vercelProjectId" | "renderServiceId", value: string) =>
  prisma.project.findFirst({ where: { [field]: value } });

const createWebhookAlert = async (projectId: string, title: string, message: string, source: string) => {
  const existing = await prisma.alert.findFirst({
    where: { projectId, sourceType: "WEBHOOK", title, status: "OPEN" }
  });

  if (existing) {
    await prisma.alert.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), message }
    });
    return;
  }

  await prisma.alert.create({
    data: {
      id: crypto.randomUUID(),
      projectId,
      sourceType: "WEBHOOK",
      sourceId: source,
      severity: "HIGH",
      title,
      message
    }
  });
};

webhooksRouter.post("/vercel", requireWebhookSignature("vercel"), async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as {
    type?: string;
    payload?: { deployment?: { url?: string; project?: { id?: string } }; target?: string };
  };

  const eventType = payload.type || "";
  const vercelProjectId = payload.payload?.deployment?.project?.id;

  if (!eventType.includes("deployment") || !eventType.includes("error")) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  if (vercelProjectId) {
    const project = await findProjectByIntegrationId("vercelProjectId", vercelProjectId);
    if (project) {
      await createWebhookAlert(
        project.id,
        "Vercel deployment failed",
        `Event: ${eventType} — URL: ${payload.payload?.deployment?.url || "unknown"}`,
        `vercel:${vercelProjectId}`
      );
    }
  }

  res.status(200).json({ ok: true });
});

webhooksRouter.post("/github", requireWebhookSignature("github"), async (req: Request, res: Response): Promise<void> => {
  const event = req.header("x-github-event") || "";
  const payload = req.body as {
    action?: string;
    workflow_run?: { conclusion?: string; name?: string; html_url?: string; repository?: { full_name?: string } };
    repository?: { full_name?: string };
  };

  if (event !== "workflow_run" || payload.workflow_run?.conclusion !== "failure") {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  const repoName = payload.workflow_run?.repository?.full_name || payload.repository?.full_name || "";
  if (repoName) {
    const project = await prisma.project.findFirst({
      where: { repoUrl: { contains: repoName } }
    });

    if (project) {
      await createWebhookAlert(
        project.id,
        "GitHub Actions workflow failed",
        `Workflow "${payload.workflow_run?.name}" failed — ${payload.workflow_run?.html_url || ""}`,
        `github:${repoName}`
      );
    }
  }

  res.status(200).json({ ok: true });
});

webhooksRouter.post("/render", requireWebhookSignature("render"), async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as {
    type?: string;
    data?: { serviceId?: string; serviceType?: string; status?: string };
  };

  const eventType = payload.type || "";
  const renderServiceId = payload.data?.serviceId;
  const status = (payload.data?.status || "").toLowerCase();

  const isDeployFailure =
    eventType.includes("deploy") &&
    status.length > 0 &&
    !["live", "succeeded", "success"].includes(status);

  if (!isDeployFailure) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  if (renderServiceId) {
    const project = await findProjectByIntegrationId("renderServiceId", renderServiceId);
    if (project) {
      await createWebhookAlert(
        project.id,
        "Render deployment failed",
        `Event: ${eventType} — Service: ${renderServiceId} — Status: ${status}`,
        `render:${renderServiceId}`
      );
    }
  }

  res.status(200).json({ ok: true });
});
