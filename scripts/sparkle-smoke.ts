import { AlertSeverity, EventType, ProjectStatus } from "@opswatch/shared";
import { createOpsWatchClient } from "@opswatch/client";

const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const client = createOpsWatchClient({
  baseUrl: requireEnv("SPARKLE_BASE_URL"),
  projectKey: requireEnv("SPARKLE_PROJECT_KEY"),
  signingSecret: requireEnv("SPARKLE_SIGNING_SECRET"),
  environment: requireEnv("SPARKLE_ENVIRONMENT"),
  appName: requireEnv("SPARKLE_APP_NAME"),
  appVersion: requireEnv("SPARKLE_APP_VERSION"),
  projectSlug: requireEnv("SPARKLE_PROJECT_SLUG")
});

const sendFailureEvent = requireEnv("SPARKLE_SEND_FAILURE_EVENT").toLowerCase() === "true";

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
