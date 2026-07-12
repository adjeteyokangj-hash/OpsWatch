let lastSchedulerSuccessAt: string | null = null;
let lastSchedulerJob: string | null = null;

export const markSchedulerSuccess = (jobName: string): void => {
  lastSchedulerSuccessAt = new Date().toISOString();
  lastSchedulerJob = jobName;
};

export const getSchedulerHealthSnapshot = () => ({
  lastSuccessAt: lastSchedulerSuccessAt,
  lastJob: lastSchedulerJob,
  stale: lastSchedulerSuccessAt
    ? Date.now() - new Date(lastSchedulerSuccessAt).getTime() > 5 * 60_000
    : true
});

export const sendWorkerHeartbeat = async (): Promise<void> => {
  const apiUrl = process.env.OPSWATCH_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.OPSWATCH_HEARTBEAT_API_KEY?.trim();
  const projectSlug = process.env.OPSWATCH_SELF_MONITOR_SLUG?.trim() || "opswatch-production";
  const environment = process.env.OPSWATCH_ENVIRONMENT?.trim() || process.env.NODE_ENV || "production";

  if (!apiUrl || !apiKey) return;

  const scheduler = getSchedulerHealthSnapshot();
  const status = scheduler.stale ? "DEGRADED" : "HEALTHY";

  const response = await fetch(`${apiUrl}/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      projectSlug,
      environment,
      status,
      message: scheduler.stale ? "Scheduler success signal is stale" : "Worker and scheduler operational",
      appVersion: process.env.npm_package_version || "worker",
      payload: {
        component: "worker",
        scheduler
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Heartbeat ingest failed with HTTP ${response.status}`);
  }
};

export const startWorkerHeartbeat = (): (() => void) => {
  const intervalMs = Number(process.env.OPSWATCH_HEARTBEAT_INTERVAL_MS || 60_000);
  if (!process.env.OPSWATCH_HEARTBEAT_API_KEY?.trim() || !process.env.OPSWATCH_API_URL?.trim()) {
    return () => undefined;
  }

  const tick = () => {
    void sendWorkerHeartbeat().catch((error) => {
      console.error("Worker heartbeat failed", error);
    });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
};
