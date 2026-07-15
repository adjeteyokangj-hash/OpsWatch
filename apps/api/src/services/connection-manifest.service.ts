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

export type ConnectionConfigField = {
  key: string;
  label: string;
  type: "url" | "string" | "number" | "select";
  required?: boolean;
  description?: string;
  options?: string[];
};

export type ConnectionManifest = {
  version: string;
  displayName: string;
  requiredCapabilities: string[];
  supportedAuthMethods: string[];
  availableCapabilities: string[];
  configurationSchema: ConnectionConfigField[];
  foundationHooks: Array<{ key: string; supported: false; reason: string }>;
};

const endpointFields: ConnectionConfigField[] = [
  { key: "endpoint", label: "Endpoint URL", type: "url", required: true, description: "HTTP or HTTPS endpoint only." },
  { key: "method", label: "Request method", type: "select", options: ["GET", "HEAD"], description: "Agentless checks do not send a request body." },
  { key: "timeoutMs", label: "Timeout (ms)", type: "number", description: "Maximum 30 seconds." }
];

const foundationHooks: ConnectionManifest["foundationHooks"] = [
  { key: "dns", supported: false, reason: "DNS probing is not implemented yet." },
  { key: "tls", supported: false, reason: "TLS certificate inspection is not implemented yet." },
  { key: "database", supported: false, reason: "Database probing is not implemented yet." },
  { key: "queue", supported: false, reason: "Queue probing is not implemented yet." },
  { key: "scheduled_jobs", supported: false, reason: "Scheduled-job ingestion is not implemented yet." },
  { key: "cloud_status", supported: false, reason: "Cloud/status-provider polling is not implemented yet." }
];

const manifests: Record<ConnectionMode, ConnectionManifest> = {
  AGENTLESS: { version: "1.0", displayName: "Generic HTTP/HTTPS monitor", requiredCapabilities: ["health_check"], supportedAuthMethods: ["NONE"], availableCapabilities: ["health_check", "latency"], configurationSchema: endpointFields, foundationHooks },
  HEARTBEAT: { version: "1.0", displayName: "Heartbeat ingest", requiredCapabilities: ["heartbeat"], supportedAuthMethods: ["HMAC", "API_KEY"], availableCapabilities: ["heartbeat", "deployment_metadata"], configurationSchema: [], foundationHooks },
  WEBHOOK: { version: "1.0", displayName: "Signed webhook event ingest", requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["HMAC"], availableCapabilities: ["event_ingest", "deployment_events"], configurationSchema: [], foundationHooks },
  API: { version: "1.0", displayName: "Generic REST/API check", requiredCapabilities: ["api_probe"], supportedAuthMethods: ["NONE"], availableCapabilities: ["api_probe", "discovery"], configurationSchema: [...endpointFields, { key: "discoveryPath", label: "Discovery path", type: "string", description: "Optional GET path used for real response-key discovery." }], foundationHooks },
  SYNTHETIC: { version: "1.0", displayName: "Synthetic journey contract", requiredCapabilities: ["synthetic_run"], supportedAuthMethods: ["NONE"], availableCapabilities: ["synthetic_run"], configurationSchema: [], foundationHooks },
  OTEL_COLLECTOR: { version: "1.0", displayName: "OpenTelemetry collector contract", requiredCapabilities: ["telemetry_ingest"], supportedAuthMethods: ["API_KEY"], availableCapabilities: ["telemetry_ingest", "traces", "metrics", "logs"], configurationSchema: [{ key: "serviceName", label: "Expected service.name", type: "string", required: true, description: "Must exactly match the Collector resource service.name." }], foundationHooks },
  SDK: { version: "1.0", displayName: "SDK event ingest contract", requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["API_KEY", "HMAC"], availableCapabilities: ["event_ingest", "traces", "deployment_metadata"], configurationSchema: [], foundationHooks },
  CLOUD_CONNECTOR: { version: "1.0", displayName: "Cloud connector contract", requiredCapabilities: ["cloud_read"], supportedAuthMethods: ["OAUTH2", "API_KEY"], availableCapabilities: ["cloud_read"], configurationSchema: [], foundationHooks },
  DATABASE_CONNECTOR: { version: "1.0", displayName: "Database connector contract", requiredCapabilities: ["database_probe"], supportedAuthMethods: ["BASIC", "API_KEY", "MTLS"], availableCapabilities: [], configurationSchema: [], foundationHooks },
  CUSTOM_CONNECTOR: { version: "1.0", displayName: "Custom connector contract", requiredCapabilities: [], supportedAuthMethods: ["NONE", "API_KEY", "HMAC", "OAUTH2", "MTLS"], availableCapabilities: [], configurationSchema: [], foundationHooks }
};

const sensitiveConfigurationKey = /(secret|password|token|credential|private.?key|api.?key|authorization|cookie)/i;

export const isConnectionMode = (value: unknown): value is ConnectionMode =>
  typeof value === "string" && (CONNECTION_MODES as readonly string[]).includes(value);

export const getConnectionManifest = (mode: ConnectionMode): ConnectionManifest => manifests[mode];

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
  if (input.configuration !== undefined && hasInlineSecret(input.configuration)) {
    return "configuration must not include secret material; provide secretRef instead";
  }
  if (typeof input.authMethod !== "string" || !getConnectionManifest(input.mode).supportedAuthMethods.includes(input.authMethod)) {
    return `authMethod is not supported for ${input.mode}`;
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

export const validateConnectionConfiguration = (
  mode: ConnectionMode,
  configuration: unknown
): { valid: true; value: Record<string, unknown> } | { valid: false; error: string } => {
  const value = configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? configuration as Record<string, unknown>
    : null;
  if (!value) return { valid: false, error: "configuration must be an object" };
  if (mode === "OTEL_COLLECTOR") {
    if (typeof value.serviceName !== "string" || !value.serviceName.trim() || value.serviceName.length > 200) {
      return { valid: false, error: "configuration.serviceName is required for OTEL_COLLECTOR" };
    }
    return { valid: true, value };
  }
  if (!["AGENTLESS", "API"].includes(mode)) return { valid: true, value };

  const endpoint = value.endpoint;
  if (typeof endpoint !== "string" || !/^https?:\/\//i.test(endpoint)) {
    return { valid: false, error: "configuration.endpoint must be an HTTP or HTTPS URL" };
  }
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return { valid: false, error: "configuration.endpoint must be a valid URL" };
  }
  if (endpointUrl.username || endpointUrl.password) {
    return { valid: false, error: "configuration.endpoint must not contain credentials" };
  }
  const isLocalTarget = endpointUrl.hostname === "localhost" ||
    endpointUrl.hostname === "::1" ||
    /^127\./.test(endpointUrl.hostname) ||
    /^10\./.test(endpointUrl.hostname) ||
    /^192\.168\./.test(endpointUrl.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(endpointUrl.hostname);
  if (process.env.NODE_ENV === "production" && isLocalTarget) {
    return { valid: false, error: "configuration.endpoint must not target a local network address in production" };
  }
  if (value.method !== undefined && !["GET", "HEAD"].includes(String(value.method).toUpperCase())) {
    return { valid: false, error: "configuration.method must be GET or HEAD" };
  }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 30_000)) {
    return { valid: false, error: "configuration.timeoutMs must be an integer between 1 and 30000" };
  }
  if (mode === "API" && value.discoveryPath !== undefined && (typeof value.discoveryPath !== "string" || !value.discoveryPath.startsWith("/"))) {
    return { valid: false, error: "configuration.discoveryPath must begin with /" };
  }
  return { valid: true, value };
};
