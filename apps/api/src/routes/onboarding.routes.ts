import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../middleware/auth";

export const onboardingRouter = Router();

const ONBOARDING_STEPS = [
  "org_created",
  "plan_selected",
  "project_created",
  "service_created",
  "check_created",
  "notification_configured",
  "status_page_created",
  "team_invited"
] as const;
onboardingRouter.get("/onboarding/progress", async (req: AuthRequest, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.json({ completedSteps: [], totalSteps: ONBOARDING_STEPS.length, steps: ONBOARDING_STEPS });
    return;
  }

  let progress = await prisma.onboardingProgress.findUnique({ where: { organizationId: orgId } });
  if (!progress) {
    progress = await prisma.onboardingProgress.create({
      data: { id: randomUUID(), organizationId: orgId, completedSteps: [], updatedAt: new Date() }
    });
  }

  const percent = Math.round((progress.completedSteps.length / ONBOARDING_STEPS.length) * 100);

  res.json({
    completedSteps: progress.completedSteps,
    totalSteps: ONBOARDING_STEPS.length,
    steps: ONBOARDING_STEPS,
    percentComplete: percent,
    isComplete: progress.completedSteps.length >= ONBOARDING_STEPS.length
  });
});

onboardingRouter.post("/onboarding/complete/:step", async (req: AuthRequest, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }

  const { step } = z.object({ step: z.enum(ONBOARDING_STEPS) }).parse({ step: req.params.step });

  let progress = await prisma.onboardingProgress.findUnique({ where: { organizationId: orgId } });
  if (!progress) {
    progress = await prisma.onboardingProgress.create({
      data: { id: randomUUID(), organizationId: orgId, completedSteps: [], updatedAt: new Date() }
    });
  }

  const updatedSteps = Array.from(new Set([...progress.completedSteps, step as string]));
  const updated = await prisma.onboardingProgress.update({
    where: { organizationId: orgId },
    data: { completedSteps: updatedSteps }
  });

  res.json({ completedSteps: updated.completedSteps });
});

onboardingRouter.delete("/onboarding/complete/:step", async (req: AuthRequest, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }

  const { step } = z.object({ step: z.enum(ONBOARDING_STEPS) }).parse({ step: req.params.step });

  const progress = await prisma.onboardingProgress.findUnique({ where: { organizationId: orgId } });
  if (!progress) {
    res.status(404).json({ error: "No onboarding progress found" });
    return;
  }

  const updatedSteps = progress.completedSteps.filter((s) => s !== (step as string));
  await prisma.onboardingProgress.update({
    where: { organizationId: orgId },
    data: { completedSteps: updatedSteps }
  });

  res.status(204).end();
});
