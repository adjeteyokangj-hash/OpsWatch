import { logger } from "../lib/logger";

const apiBase = (): string =>
  (process.env.OPSWATCH_API_URL || "http://127.0.0.1:4000/api").replace(/\/+$/, "");

const workerInternalSecret = (): string | undefined =>
  process.env.WORKER_INTERNAL_SECRET?.trim() || undefined;

export const runIncidentAutoHealJob = async (): Promise<void> => {
  if (process.env.WORKER_AUTO_HEAL_ENABLED === "false") {
    return;
  }

  const secret = workerInternalSecret();
  if (!secret) {
    throw new Error("WORKER_INTERNAL_SECRET is not configured");
  }

  const response = await fetch(`${apiBase()}/internal/auto-heal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opswatch-worker-secret": secret
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Auto-heal sweep failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as {
    scanned: number;
    attempted: number;
  };

  logger.info(
    `Auto-heal sweep scanned ${payload.scanned} incident(s); attempted ${payload.attempted}`
  );
};
