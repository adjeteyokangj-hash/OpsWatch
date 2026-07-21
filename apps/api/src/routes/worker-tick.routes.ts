import { Router } from "express";
import { requireCronSecret } from "../middleware/cron-auth";
import { loadDefaultJobRunners } from "../services/worker-tick/job-registry";
import { runServerlessWorkerTick } from "../services/worker-tick/serverless-tick.service";

export const workerTickRouter = Router();

/**
 * Supabase-Cron entrypoint for the serverless worker mode. Called every minute:
 *
 *   POST /api/internal/worker/tick
 *   Authorization: Bearer <OPSWATCH_CRON_SECRET>
 *
 * Runs the due subset of the worker job batch under a cross-process lease and
 * within a bounded execution budget, then returns a JSON job summary. Does not
 * replace the continuous worker (apps/worker); both can run concurrently and
 * are protected against overlap by the same lease.
 */
workerTickRouter.post("/internal/worker/tick", requireCronSecret, async (_req, res) => {
  const runners = await loadDefaultJobRunners();
  const summary = await runServerlessWorkerTick({ runners, triggeredBy: "supabase-cron" });
  res.status(200).json(summary);
});
