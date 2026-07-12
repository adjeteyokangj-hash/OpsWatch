import { Router } from "express";
import { requireWorkerInternal } from "../middleware/worker-internal";
import { runAutoHealSweep } from "../services/remediation/auto-heal.service";
import { runAutonomousAutomationSweep } from "../services/automation/automation-run-executor.service";

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
