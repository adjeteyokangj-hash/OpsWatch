import { AlertSeverity, EventType, ProjectStatus } from "@opswatch/shared";
import { createOpsWatchClient } from "@opswatch/client";

const client = createOpsWatchClient({
  baseUrl: "http://localhost:4000",
  projectKey: "sparkle",
  signingSecret: "sparkle-secret",
  environment: "production",
  appName: "Sparkle",
  appVersion: "0.1.0",
  projectSlug: "sparkle"
});

const sendFailureEvent = (process.env.SPARKLE_SEND_FAILURE_EVENT || "false").toLowerCase() === "true";

const main = async (): Promise<void> => {
  await client.sendHeartbeat({
    status: ProjectStatus.HEALTHY,
    message: "Sparkle heartbeat integration test",
    payload: {
      source: "local-smoke"
    }
  });

  if (sendFailureEvent) {
    await client.sendEvent({
      type: EventType.PAYMENT_FAILED,
      severity: AlertSeverity.HIGH,
      message: "Sparkle payment failure integration test",
      payload: {
        orderId: "test-123",
        source: "local-smoke"
      }
    });
  }

  console.log("Sparkle connector smoke sent");
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
