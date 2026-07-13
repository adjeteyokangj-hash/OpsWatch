import { IntegrationType } from "@prisma/client";

export type IntegrationHealthCheckStatus = "pass" | "fail" | "warn" | "pending";

export type IntegrationValidationDetails = {
  connectionState: "not_configured" | "saved" | "connected" | "failed";
  health: "healthy" | "degraded" | "unhealthy" | "unknown";
  checks: Array<{
    id: string;
    label: string;
    status: IntegrationHealthCheckStatus;
    detail?: string;
  }>;
  account?: {
    name?: string;
    mode?: "test" | "live";
    apiVersion?: string;
  };
  webhook?: {
    configured: boolean;
    verified: boolean;
  };
  missingFields?: string[];
  lastCheckedAt: string;
};

export type IntegrationValidationResult = {
  status: "VALID" | "INVALID";
  message: string;
  details: IntegrationValidationDetails;
};

export const INTEGRATION_REQUIRED_KEYS: Record<IntegrationType, string[]> = {
  WEBHOOK: ["WEBHOOK_URL"],
  EMAIL: ["EMAIL_PROVIDER_HEALTHCHECK_URL"],
  STRIPE: ["STRIPE_API_KEY"],
  WORKER_PROVIDER: ["WORKER_RESTART_WEBHOOK_URL"],
  SERVICE_PROVIDER: ["SERVICE_RESTART_WEBHOOK_URL"],
  DEPLOYMENT_PROVIDER: ["DEPLOYMENT_ROLLBACK_WEBHOOK_URL"],
  STATUS_PROVIDER: ["PROVIDER_STATUS_URL"],
  RUNBOOK_PROVIDER: ["RUNBOOK_BASE_URL"]
};

export const INTEGRATION_RECOMMENDED_KEYS: Partial<Record<IntegrationType, string[]>> = {
  STRIPE: ["STRIPE_WEBHOOK_SECRET", "STRIPE_API_BASE"],
  WEBHOOK: ["WEBHOOK_SIGNING_HEADER"],
  EMAIL: ["EMAIL_FROM"]
};

export const readConfigValue = (
  config: Record<string, unknown> | null | undefined,
  key: string
): string | undefined => {
  const fromConfig = config?.[key];
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig.trim();
  }
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return undefined;
};

const missingFieldLabels: Record<string, string> = {
  STRIPE_API_KEY: "Secret key",
  STRIPE_WEBHOOK_SECRET: "Webhook secret",
  STRIPE_API_BASE: "API base",
  WEBHOOK_URL: "Webhook URL",
  EMAIL_PROVIDER_HEALTHCHECK_URL: "Health check URL",
  WORKER_RESTART_WEBHOOK_URL: "Restart webhook URL",
  SERVICE_RESTART_WEBHOOK_URL: "Restart webhook URL",
  DEPLOYMENT_ROLLBACK_WEBHOOK_URL: "Rollback webhook URL",
  PROVIDER_STATUS_URL: "Status URL",
  RUNBOOK_BASE_URL: "Runbook base URL"
};

const labelForKey = (key: string): string => missingFieldLabels[key] ?? key;

const detectStripeMode = (apiKey: string, livemode?: boolean): "test" | "live" => {
  if (apiKey.startsWith("sk_live_") || apiKey.startsWith("rk_live_")) return "live";
  if (apiKey.startsWith("sk_test_") || apiKey.startsWith("rk_test_")) return "test";
  if (livemode === true) return "live";
  if (livemode === false) return "test";
  return "test";
};

const connectivityProbe = async (url: string): Promise<{ ok: boolean; message: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (response.ok) {
      return { ok: true, message: `Connectivity probe succeeded (${response.status}).` };
    }
    return { ok: false, message: `Connectivity probe failed (${response.status}).` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Connectivity probe error: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
};

const buildDetails = (
  input: Partial<IntegrationValidationDetails> & Pick<IntegrationValidationDetails, "connectionState" | "health" | "checks">
): IntegrationValidationDetails => ({
  connectionState: input.connectionState,
  health: input.health,
  checks: input.checks,
  account: input.account,
  webhook: input.webhook,
  missingFields: input.missingFields,
  lastCheckedAt: new Date().toISOString()
});

const validateStripe = async (
  config: Record<string, unknown> | null
): Promise<IntegrationValidationResult> => {
  const requiredKeys = INTEGRATION_REQUIRED_KEYS.STRIPE;
  const missing = requiredKeys.filter((key) => !readConfigValue(config, key));
  const missingLabels = missing.map(labelForKey);
  const webhookSecret = readConfigValue(config, "STRIPE_WEBHOOK_SECRET");
  const apiKey = readConfigValue(config, "STRIPE_API_KEY");
  const apiBase = readConfigValue(config, "STRIPE_API_BASE") ?? "https://api.stripe.com";

  if (missing.length > 0) {
    return {
      status: "INVALID",
      message: `Missing required credentials: ${missingLabels.join(", ")}`,
      details: buildDetails({
        connectionState: "failed",
        health: "unhealthy",
        missingFields: missingLabels,
        webhook: { configured: Boolean(webhookSecret), verified: false },
        checks: [
          { id: "api", label: "API reachable", status: "pending" },
          { id: "credentials", label: "Credentials accepted", status: "fail", detail: "Secret key is required" },
          {
            id: "webhook-secret",
            label: "Webhook secret configured",
            status: webhookSecret ? "pass" : "warn",
            detail: webhookSecret ? undefined : "Recommended for webhook verification"
          },
          { id: "portal", label: "Billing portal available", status: "pending" },
          { id: "checkout", label: "Checkout ready", status: "pending" }
        ]
      })
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const [balanceResponse, accountResponse] = await Promise.all([
      fetch(`${apiBase}/v1/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal
      }),
      fetch(`${apiBase}/v1/account`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal
      })
    ]);

    const apiReachable = balanceResponse.status !== 0;
    const credentialsAccepted = balanceResponse.ok;
    let accountName: string | undefined;
    let mode: "test" | "live" = detectStripeMode(apiKey as string);

    if (accountResponse.ok) {
      const account = (await accountResponse.json()) as {
        business_profile?: { name?: string };
        settings?: { dashboard?: { display_name?: string } };
        livemode?: boolean;
      };
      accountName =
        account.business_profile?.name?.trim() ||
        account.settings?.dashboard?.display_name?.trim() ||
        undefined;
      mode = detectStripeMode(apiKey as string, account.livemode);
    }

    const checks: IntegrationValidationDetails["checks"] = [
      {
        id: "api",
        label: "API reachable",
        status: apiReachable ? "pass" : "fail"
      },
      {
        id: "credentials",
        label: "Credentials accepted",
        status: credentialsAccepted ? "pass" : "fail",
        detail: credentialsAccepted ? undefined : `Stripe returned ${balanceResponse.status}`
      },
      {
        id: "webhook-secret",
        label: "Webhook secret configured",
        status: webhookSecret ? "pass" : "warn",
        detail: webhookSecret ? undefined : "Recommended for webhook verification"
      },
      {
        id: "portal",
        label: "Billing portal available",
        status: credentialsAccepted ? "pass" : "fail"
      },
      {
        id: "checkout",
        label: "Checkout ready",
        status: credentialsAccepted ? "pass" : "fail"
      }
    ];

    const health = credentialsAccepted
      ? webhookSecret
        ? "healthy"
        : "degraded"
      : "unhealthy";

    if (!credentialsAccepted) {
      return {
        status: "INVALID",
        message: `Stripe validation failed (${balanceResponse.status}).`,
        details: buildDetails({
          connectionState: "failed",
          health,
          account: { name: accountName, mode, apiVersion: "2026-06-30" },
          webhook: { configured: Boolean(webhookSecret), verified: false },
          checks
        })
      };
    }

    return {
      status: "VALID",
      message: "Successfully connected to Stripe.",
      details: buildDetails({
        connectionState: "connected",
        health,
        account: { name: accountName, mode, apiVersion: "2026-06-30" },
        webhook: { configured: Boolean(webhookSecret), verified: Boolean(webhookSecret) },
        checks
      })
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "INVALID",
      message: `Stripe validation error: ${message}`,
      details: buildDetails({
        connectionState: "failed",
        health: "unhealthy",
        webhook: { configured: Boolean(webhookSecret), verified: false },
        checks: [
          { id: "api", label: "API reachable", status: "fail", detail: message },
          { id: "credentials", label: "Credentials accepted", status: "fail" },
          {
            id: "webhook-secret",
            label: "Webhook secret configured",
            status: webhookSecret ? "pass" : "warn"
          },
          { id: "portal", label: "Billing portal available", status: "fail" },
          { id: "checkout", label: "Checkout ready", status: "fail" }
        ]
      })
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const validateIntegrationConnectivity = async (row: {
  type: IntegrationType;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
}): Promise<IntegrationValidationResult> => {
  if (!row.enabled) {
    return {
      status: "INVALID",
      message: "Integration is disabled.",
      details: buildDetails({
        connectionState: "failed",
        health: "unhealthy",
        checks: [{ id: "enabled", label: "Integration enabled", status: "fail" }]
      })
    };
  }

  const requiredKeys = INTEGRATION_REQUIRED_KEYS[row.type] ?? [];
  const missing = requiredKeys.filter((key) => !readConfigValue(row.configJson, key));
  if (missing.length > 0) {
    const missingLabels = missing.map(labelForKey);
    return {
      status: "INVALID",
      message: `Missing required configuration: ${missingLabels.join(", ")}`,
      details: buildDetails({
        connectionState: "failed",
        health: "unhealthy",
        missingFields: missingLabels,
        checks: missingLabels.map((label) => ({
          id: label,
          label,
          status: "fail" as const
        }))
      })
    };
  }

  if (row.type === "STRIPE") {
    return validateStripe(row.configJson);
  }

  const urlKeys = [
    "WEBHOOK_URL",
    "WORKER_RESTART_WEBHOOK_URL",
    "SERVICE_RESTART_WEBHOOK_URL",
    "DEPLOYMENT_ROLLBACK_WEBHOOK_URL",
    "PROVIDER_STATUS_URL",
    "RUNBOOK_BASE_URL",
    "EMAIL_PROVIDER_HEALTHCHECK_URL"
  ];
  const url = urlKeys
    .map((key) => readConfigValue(row.configJson, key))
    .find((value): value is string => Boolean(value));

  if (!url) {
    return {
      status: "VALID",
      message: "Required configuration saved.",
      details: buildDetails({
        connectionState: "connected",
        health: "healthy",
        checks: [
          { id: "config", label: "Required fields configured", status: "pass" },
          {
            id: "probe",
            label: "Connectivity probe",
            status: "warn",
            detail: "No probe URL configured"
          }
        ]
      })
    };
  }

  const probe = await connectivityProbe(url);
  return {
    status: probe.ok ? "VALID" : "INVALID",
    message: probe.message,
    details: buildDetails({
      connectionState: probe.ok ? "connected" : "failed",
      health: probe.ok ? "healthy" : "unhealthy",
      checks: [
        { id: "config", label: "Required fields configured", status: "pass" },
        {
          id: "probe",
          label: "Endpoint reachable",
          status: probe.ok ? "pass" : "fail",
          detail: probe.ok ? undefined : probe.message
        }
      ]
    })
  };
};

export const buildSavedIntegrationDetails = (
  type: IntegrationType,
  config: Record<string, unknown> | null | undefined
): IntegrationValidationDetails => {
  const requiredKeys = INTEGRATION_REQUIRED_KEYS[type] ?? [];
  const recommendedKeys = INTEGRATION_RECOMMENDED_KEYS[type] ?? [];
  const missingRequired = requiredKeys.filter((key) => !readConfigValue(config, key));
  const hasAnyValue = [...requiredKeys, ...recommendedKeys].some((key) => readConfigValue(config, key));

  if (!hasAnyValue) {
    return buildDetails({
      connectionState: "not_configured",
      health: "unknown",
      missingFields: requiredKeys.map(labelForKey),
      checks: requiredKeys.map((key) => ({
        id: key,
        label: labelForKey(key),
        status: "pending"
      }))
    });
  }

  const checks = [
    ...requiredKeys.map((key) => ({
      id: key,
      label: labelForKey(key),
      status: readConfigValue(config, key) ? ("pass" as const) : ("fail" as const)
    })),
    ...recommendedKeys
      .filter((key) => !requiredKeys.includes(key))
      .map((key) => ({
        id: key,
        label: labelForKey(key),
        status: readConfigValue(config, key) ? ("pass" as const) : ("warn" as const)
      }))
  ];

  if (type === "STRIPE") {
    const apiKey = readConfigValue(config, "STRIPE_API_KEY");
    const mode = apiKey ? detectStripeMode(apiKey) : undefined;
    return buildDetails({
      connectionState: "saved",
      health: missingRequired.length > 0 ? "degraded" : "unknown",
      missingFields: missingRequired.map(labelForKey),
      account: mode ? { mode } : undefined,
      webhook: {
        configured: Boolean(readConfigValue(config, "STRIPE_WEBHOOK_SECRET")),
        verified: false
      },
      checks
    });
  }

  return buildDetails({
    connectionState: "saved",
    health: missingRequired.length > 0 ? "degraded" : "unknown",
    missingFields: missingRequired.map(labelForKey),
    checks
  });
};
