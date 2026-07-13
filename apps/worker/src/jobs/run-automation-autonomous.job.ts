import { logger } from "../lib/logger";

const apiBase = (): string =>
  (process.env.OPSWATCH_API_URL || "http://127.0.0.1:4000/api").replace(/\/+$/, "");

const workerInternalSecret = (): string | undefined =>
  process.env.WORKER_INTERNAL_SECRET?.trim() || undefined;

export const runAutomationAutonomousJob = async (): Promise<void> => {
  if (process.env.WORKER_AUTOMATION_AUTONOMOUS_ENABLED !== "true") {
    return;
  }

  const secret = workerInternalSecret();
  if (!secret) {
    throw new Error("WORKER_INTERNAL_SECRET is not configured");
  }

  const response = await fetch(`${apiBase()}/internal/automation/autonomous/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opswatch-worker-secret": secret
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Automation autonomous sweep failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { scanned: number; attempted: number };
  logger.info(
    `Automation autonomous sweep scanned ${payload.scanned} run(s); attempted ${payload.attempted}`
  );
};
