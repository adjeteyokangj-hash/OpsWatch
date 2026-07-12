import { AlertSeverity, EventType, ProjectStatus } from "@opswatch/shared";
import { createOpsWatchClient } from "@opswatch/client";

const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const heartbeatIntervalRaw = requireEnv("DEMO_HEARTBEAT_INTERVAL_MS");
const heartbeatIntervalMs = Number(heartbeatIntervalRaw);
if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
  throw new Error(`DEMO_HEARTBEAT_INTERVAL_MS must be a positive number; received '${heartbeatIntervalRaw}'`);
}

const sendBootEvent = requireEnv("DEMO_SEND_BOOT_EVENT").toLowerCase() !== "false";

const client = createOpsWatchClient({
  baseUrl: requireEnv("OPSWATCH_BASE_URL"),
  projectKey: requireEnv("OPSWATCH_PROJECT_KEY"),
  signingSecret: requireEnv("OPSWATCH_SIGNING_SECRET"),
  environment: requireEnv("DEMO_APP_ENV"),
  appName: requireEnv("DEMO_APP_NAME"),
  appVersion: requireEnv("DEMO_APP_VERSION"),
  projectSlug: requireEnv("DEMO_PROJECT_SLUG")
});

const sendHeartbeatTick = async (): Promise<void> => {
  await client.sendHeartbeat({
    status: ProjectStatus.HEALTHY,
    message: "Demo app heartbeat",
    payload: {
      source: "demo-real-app",
      at: new Date().toISOString()
    }
  });
};

const sendStructuredEvent = async (): Promise<void> => {
  await client.sendEvent({
    type: EventType.DEPLOYMENT_FINISHED,
    severity: AlertSeverity.INFO,
    source: "demo-real-app",
    message: "Demo app deployment event",
    payload: {
      release: requireEnv("DEMO_APP_VERSION"),
      region: requireEnv("DEMO_APP_REGION")
    }
  });
};

const main = async (): Promise<void> => {
  console.log("DEMO_APP_START");
  console.log(`Heartbeat interval: ${heartbeatIntervalMs}ms`);

  await sendHeartbeatTick();
  console.log("HEARTBEAT_SENT");

  if (sendBootEvent) {
    await sendStructuredEvent();
    console.log("EVENT_SENT");
  }

  setInterval(() => {
    void sendHeartbeatTick()
      .then(() => console.log("HEARTBEAT_SENT"))
      .catch((error) => console.error("HEARTBEAT_SEND_FAILED", error));
  }, heartbeatIntervalMs);
};

process.on("SIGINT", () => {
  console.log("DEMO_APP_STOP");
  process.exit(0);
});

void main().catch((error) => {
  console.error("DEMO_APP_FAILED", error);
  process.exit(1);
});
