export const CONNECTION_MODES = [
  "AGENTLESS",
  "HEARTBEAT",
  "WEBHOOK",
  "API",
  "SYNTHETIC",
  "OTEL_COLLECTOR",
  "SDK",
  "CLOUD_CONNECTOR",
  "DATABASE_CONNECTOR",
  "CUSTOM_CONNECTOR"
] as const;

export type ConnectionMode = (typeof CONNECTION_MODES)[number];

type Manifest = {
  requiredCapabilities: string[];
  supportedAuthMethods: string[];
  availableCapabilities: string[];
};

const manifests: Record<ConnectionMode, Manifest> = {
  AGENTLESS: { requiredCapabilities: ["health_check"], supportedAuthMethods: ["NONE", "BASIC", "BEARER", "HEADER"], availableCapabilities: ["health_check", "latency", "tls"] },
  HEARTBEAT: { requiredCapabilities: ["heartbeat"], supportedAuthMethods: ["HMAC", "API_KEY"], availableCapabilities: ["heartbeat", "deployment_metadata"] },
  WEBHOOK: { requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["HMAC", "API_KEY"], availableCapabilities: ["event_ingest", "deployment_events"] },
  API: { requiredCapabilities: ["api_probe"], supportedAuthMethods: ["NONE", "BASIC", "BEARER", "HEADER", "OAUTH2"], availableCapabilities: ["api_probe", "discovery", "metrics"] },
  SYNTHETIC: { requiredCapabilities: ["synthetic_run"], supportedAuthMethods: ["NONE"], availableCapabilities: ["synthetic_run"] },
  OTEL_COLLECTOR: { requiredCapabilities: ["telemetry_ingest"], supportedAuthMethods: ["API_KEY", "MTLS"], availableCapabilities: ["telemetry_ingest", "traces", "metrics", "logs"] },
  SDK: { requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["API_KEY", "HMAC"], availableCapabilities: ["event_ingest", "traces", "deployment_metadata"] },
  CLOUD_CONNECTOR: { requiredCapabilities: ["cloud_read"], supportedAuthMethods: ["OAUTH2", "API_KEY"], availableCapabilities: ["cloud_read", "discovery", "metrics"] },
  DATABASE_CONNECTOR: { requiredCapabilities: ["database_probe"], supportedAuthMethods: ["BASIC", "API_KEY", "MTLS"], availableCapabilities: ["database_probe", "metrics"] },
  CUSTOM_CONNECTOR: { requiredCapabilities: [], supportedAuthMethods: ["NONE", "API_KEY", "HMAC", "OAUTH2", "MTLS"], availableCapabilities: [] }
};

const sensitiveConfigurationKey = /(secret|password|token|credential|private.?key|api.?key)/i;

export const isConnectionMode = (value: unknown): value is ConnectionMode =>
  typeof value === "string" && (CONNECTION_MODES as readonly string[]).includes(value);

export const getConnectionManifest = (mode: ConnectionMode): Manifest => manifests[mode];

export const negotiateCapabilities = (mode: ConnectionMode, requested: unknown): {
  accepted: string[];
  rejected: string[];
  required: string[];
} => {
  const requestedValues = Array.isArray(requested)
    ? requested.filter((value): value is string => typeof value === "string")
    : [];
  const manifest = getConnectionManifest(mode);
  const available = new Set(manifest.availableCapabilities);
  return {
    accepted: requestedValues.filter((value) => available.has(value)),
    rejected: requestedValues.filter((value) => !available.has(value)),
    required: manifest.requiredCapabilities
  };
};

export const hasInlineSecret = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasInlineSecret);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => sensitiveConfigurationKey.test(key) || hasInlineSecret(child)
  );
};

export const validateConnectionInput = (input: {
  mode: unknown;
  authMethod: unknown;
  capabilities?: unknown;
  configuration?: unknown;
  secretRef?: unknown;
}): string | null => {
  if (!isConnectionMode(input.mode)) return `mode must be one of: ${CONNECTION_MODES.join(", ")}`;
  if (typeof input.authMethod !== "string" || !getConnectionManifest(input.mode).supportedAuthMethods.includes(input.authMethod)) {
    return `authMethod is not supported for ${input.mode}`;
  }
  if (input.configuration !== undefined && hasInlineSecret(input.configuration)) {
    return "configuration must not include secret material; provide secretRef instead";
  }
  if (input.secretRef !== undefined && input.secretRef !== null && (typeof input.secretRef !== "string" || !input.secretRef.trim())) {
    return "secretRef must be a non-empty reference when provided";
  }
  const negotiation = negotiateCapabilities(input.mode, input.capabilities);
  if (negotiation.rejected.length) return `unsupported capabilities: ${negotiation.rejected.join(", ")}`;
  const missingRequiredCapabilities = negotiation.required.filter(
    (capability) => !negotiation.accepted.includes(capability)
  );
  if (missingRequiredCapabilities.length) {
    return `missing required capabilities: ${missingRequiredCapabilities.join(", ")}`;
  }
  return null;
};
