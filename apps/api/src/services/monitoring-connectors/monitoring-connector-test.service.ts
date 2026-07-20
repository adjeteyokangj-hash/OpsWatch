import { validateConnectionConfiguration } from "../connection-manifest.service";
import {
  resolveConnectionSecrets,
  sanitizeConnectionError
} from "../credentials/connection-credential.service";
import { monitoringHttpGetJson } from "./monitoring-connector-http.client";
import { resolveMonitoringProfile } from "./monitoring-connector-profile.registry";
import {
  isMonitoringConnectorMode,
  type MonitoringConnectionRow
} from "./monitoring-connector-types";

export type MonitoringConnectionTestResult = {
  succeeded: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  error?: string;
  errorCategory?: string;
  authenticationPassed?: boolean;
  healthPassed?: boolean;
  limitations?: string[];
};

export const testMonitoringConnection = async (
  connection: MonitoringConnectionRow,
  options: { authSecret?: string } = {}
): Promise<MonitoringConnectionTestResult> => {
  if (!isMonitoringConnectorMode(connection.mode)) {
    return {
      succeeded: false,
      error: "Connection mode does not support monitoring source validation",
      errorCategory: "INVALID_RESPONSE"
    };
  }
  const validated = validateConnectionConfiguration(connection.mode, connection.configurationJson);
  if (!validated.valid) {
    return { succeeded: false, error: validated.error, errorCategory: "INVALID_RESPONSE" };
  }
  const configuration = validated.value;
  const baseUrl = String(configuration.baseUrl ?? configuration.endpoint ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    return { succeeded: false, error: "configuration.baseUrl is required", errorCategory: "INVALID_RESPONSE" };
  }
  const profile = resolveMonitoringProfile(connection.mode, configuration);
  const healthPath = String(configuration.healthPath ?? profile.defaultHealthPath);
  const secrets = options.authSecret
    ? [options.authSecret]
    : (await resolveConnectionSecrets(connection)).map((entry) => entry.plaintext);
  const secret = secrets[0] ?? null;
  try {
    const response = await monitoringHttpGetJson<{ status?: string; ok?: boolean }>({
      baseUrl,
      path: healthPath,
      authMethod: connection.authMethod,
      secret,
      configuration,
      timeoutMs: Number(configuration.timeoutMs ?? 15_000)
    });
    const body = response.data;
    const healthPassed = body?.ok === true || body?.status === "ok" || response.statusCode === 200;
    return {
      succeeded: healthPassed,
      statusCode: response.statusCode,
      responseTimeMs: response.responseTimeMs,
      authenticationPassed: response.statusCode !== 401 && response.statusCode !== 403,
      healthPassed,
      limitations: profile.limitations
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monitoring source test failed";
    return {
      succeeded: false,
      error: sanitizeConnectionError(message, secrets),
      errorCategory: (error as { category?: string }).category ?? "INVALID_RESPONSE",
      authenticationPassed: (error as { category?: string }).category !== "AUTHENTICATION_FAILED" ? false : false
    };
  }
};
