import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

export const webhooksRouter = Router();

// ---------- helpers ----------

const safeCompare = (a: string, b: string): boolean => {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

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

// ---------- Vercel ----------

webhooksRouter.post("/webhooks/vercel", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = JSON.stringify(req.body);
    const sig = req.header("x-vercel-signature") || "";
    const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
    if (!safeCompare(sig, expected)) {
      res.status(401).json({ error: "Invalid Vercel signature" });
      return;
    }
  }

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
        `Vercel deployment failed`,
        `Event: ${eventType} — URL: ${payload.payload?.deployment?.url || "unknown"}`,
        `vercel:${vercelProjectId}`
      );
    }
  }

  res.status(200).json({ ok: true });
});

// ---------- GitHub ----------

webhooksRouter.post("/webhooks/github", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = JSON.stringify(req.body);
    const sig = req.header("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!safeCompare(sig, expected)) {
      res.status(401).json({ error: "Invalid GitHub signature" });
      return;
    }
  }

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
        `GitHub Actions workflow failed`,
        `Workflow "${payload.workflow_run?.name}" failed — ${payload.workflow_run?.html_url || ""}`,
        `github:${repoName}`
      );
    }
  }

  res.status(200).json({ ok: true });
});

// ---------- Render ----------

webhooksRouter.post("/webhooks/render", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.RENDER_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = JSON.stringify(req.body);
    const sig = req.header("x-render-signature") || "";
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!safeCompare(sig, expected)) {
      res.status(401).json({ error: "Invalid Render signature" });
      return;
    }
  }

  const payload = req.body as {
    type?: string;
    data?: { serviceId?: string; serviceType?: string; status?: string };
  };

  const eventType = payload.type || "";
  const renderServiceId = payload.data?.serviceId;
  const status = payload.data?.status;

  if (!eventType.includes("deploy") || status === "live") {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  if (renderServiceId) {
    const project = await findProjectByIntegrationId("renderServiceId", renderServiceId);
    if (project) {
      await createWebhookAlert(
        project.id,
        `Render deployment failed`,
        `Event: ${eventType} — Service: ${renderServiceId} — Status: ${status || "unknown"}`,
        `render:${renderServiceId}`
      );
    }
  }

  res.status(200).json({ ok: true });
});
