import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireWorkerInternal } from "../middleware/worker-internal";
import { runAutoHealSweep } from "../services/remediation/auto-heal.service";
import { runAutonomousAutomationSweep } from "../services/automation/automation-run-executor.service";
import { prisma } from "../lib/prisma";
import { assertPasswordMeetsPolicy } from "../utils/password-policy";
import { revokeAllUserSessions } from "../services/session.service";

export const internalRouter = Router();

internalRouter.post("/internal/auto-heal/run", requireWorkerInternal, async (_req, res) => {
  const results = await runAutoHealSweep();
  const attempted = results.filter((row) => row.attempted).length;
  res.status(202).json({
    accepted: true,
    scanned: results.length,
    attempted,
    results
  });
});

internalRouter.post("/internal/automation/autonomous/run", requireWorkerInternal, async (_req, res) => {
  const result = await runAutonomousAutomationSweep();
  res.status(202).json({ accepted: true, ...result });
});

/** Recover platform admin login (production break-glass). Requires WORKER_INTERNAL_SECRET. */
internalRouter.post("/internal/bootstrap/reset-admin-password", requireWorkerInternal, async (req, res) => {
  const email = String(req.body?.email ?? process.env.SEED_ADMIN_EMAIL ?? "admin@okanggroup.com")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? process.env.SEED_ADMIN_PASSWORD ?? "").trim();
  if (!password) {
    res.status(400).json({ error: "password or SEED_ADMIN_PASSWORD is required" });
    return;
  }

  try {
    assertPasswordMeetsPolicy(password);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid password" });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } }
  });
  if (!user) {
    res.status(404).json({ error: `User not found: ${email}` });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      isActive: true,
      isPlatformSuperAdmin: true,
      role: user.role === "ADMIN" ? user.role : "ADMIN",
      updatedAt: new Date()
    }
  });
  await revokeAllUserSessions(user.id, "BOOTSTRAP_PASSWORD_RESET");

  res.json({ ok: true, email: user.email });
});
