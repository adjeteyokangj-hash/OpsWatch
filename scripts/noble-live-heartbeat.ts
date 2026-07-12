import { AlertSeverity, EventType, ProjectStatus } from "@opswatch/shared";
import { createOpsWatchClient } from "@opswatch/client";

const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const heartbeatIntervalRaw = process.env.NOBLE_HEARTBEAT_INTERVAL_MS?.trim() || "300000";
const heartbeatIntervalMs = Number(heartbeatIntervalRaw);
if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
  throw new Error(`NOBLE_HEARTBEAT_INTERVAL_MS must be a positive number; received '${heartbeatIntervalRaw}'`);
}

const sendBootEvent = (process.env.NOBLE_SEND_BOOT_EVENT ?? "true").toLowerCase() !== "false";
const runOnce = (process.env.NOBLE_RUN_ONCE ?? "false").toLowerCase() === "true";

const client = createOpsWatchClient({
  baseUrl: requireEnv("OPSWATCH_API_URL"),
  projectKey: requireEnv("NOBLE_API_KEY"),
  signingSecret: requireEnv("NOBLE_SIGNING_SECRET"),
  environment: process.env.NOBLE_APP_ENV?.trim() || "production",
  appName: process.env.NOBLE_APP_NAME?.trim() || "Noble Express",
  appVersion: process.env.NOBLE_APP_VERSION?.trim() || "1.0.0",
  projectSlug: process.env.NOBLE_EXPRESS_PROJECT_SLUG?.trim() || "noble-express"
});

const sendHeartbeatTick = async (): Promise<void> => {
  await client.sendHeartbeat({
    status: ProjectStatus.HEALTHY,
    message: "Noble Express live heartbeat",
    payload: {
      source: "noble-live-heartbeat",
      at: new Date().toISOString()
    }
  });
};

const main = async (): Promise<void> => {
  console.log("NOBLE_LIVE_START");
  await sendHeartbeatTick();
  console.log("HEARTBEAT_SENT");

  if (sendBootEvent) {
    await client.sendEvent({
      type: EventType.DEPLOYMENT_FINISHED,
      severity: AlertSeverity.INFO,
      source: "noble-live-heartbeat",
      message: "Noble Express live monitoring connected",
      payload: {
        connectedAt: new Date().toISOString()
      }
    });
    console.log("EVENT_SENT");
  }

  if (runOnce) {
    return;
  }

  setInterval(() => {
    void sendHeartbeatTick()
      .then(() => console.log("HEARTBEAT_SENT"))
      .catch((error) => console.error("HEARTBEAT_SEND_FAILED", error));
  }, heartbeatIntervalMs);
};

process.on("SIGINT", () => {
  console.log("NOBLE_LIVE_STOP");
  process.exit(0);
});

void main().catch((error) => {
  console.error("NOBLE_LIVE_FAILED", error);
  process.exit(1);
});
