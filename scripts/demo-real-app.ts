import { AlertSeverity, EventType, ProjectStatus } from "@opswatch/shared";
import { createOpsWatchClient } from "@opswatch/client";

const heartbeatIntervalMs = Number(process.env.DEMO_HEARTBEAT_INTERVAL_MS || 300000);
const sendBootEvent = (process.env.DEMO_SEND_BOOT_EVENT || "true").toLowerCase() !== "false";

const client = createOpsWatchClient({
  baseUrl: process.env.OPSWATCH_BASE_URL || "http://localhost:4000",
  projectKey: process.env.OPSWATCH_PROJECT_KEY || "sparkle",
  signingSecret: process.env.OPSWATCH_SIGNING_SECRET || "sparkle-secret",
  environment: process.env.DEMO_APP_ENV || "production",
  appName: process.env.DEMO_APP_NAME || "opswatch-demo-app",
  appVersion: process.env.DEMO_APP_VERSION || "1.0.0",
  projectSlug: process.env.DEMO_PROJECT_SLUG || "sparkle"
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
      release: process.env.DEMO_APP_VERSION || "1.0.0",
      region: process.env.DEMO_APP_REGION || "local"
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
