import {
  isMonitoringConnectorMode
} from "./monitoring-connectors/monitoring-connector-types";
import { resolveMonitoringProfile } from "./monitoring-connectors/monitoring-connector-profile.registry";

export const CONNECTION_MODES = [
  "AGENTLESS",
  "HEARTBEAT",
  "WEBHOOK",
  "API",
  "METRICS_ALERTS_CONNECTOR",
  "APPLICATION_PERFORMANCE_CONNECTOR",
  "INFRASTRUCTURE_MONITORING_CONNECTOR",
  "SYNTHETIC",
  "OTEL_COLLECTOR",
  "SDK",
  "CLOUD_CONNECTOR",
  "DATABASE_CONNECTOR",
  "CUSTOM_CONNECTOR"
] as const;

export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const TRUE_NUMERIS_PROFILE = {
  baseUrl: "https://api.truenumeris.com",
  healthPath: "/api/v1/health",
  discoveryPath: "/api/v1/integrations/ping",
  authMethod: "BEARER",
  authHeaderName: "Authorization",
  authPrefix: "Bearer"
} as const;

export type GuidedConnectionInput = {
  projectId: string | null;
  name: string;
  environment: string;
  type: string;
  mode: ConnectionMode;
  authMethod: string;
  authSecret?: string;
  capabilities: string[];
  configuration: Record<string, unknown>;
  secretRef?: string | null;
  startMonitoring: boolean;
};

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
  productStatus: "Available" | "Preview" | "Planned" | "Requires configuration";
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

const monitoringConnectorFields: ConnectionConfigField[] = [
  ...endpointFields,
  {
    key: "syncPath",
    label: "Sync path",
    type: "string",
    required: true,
    description: "Relative path used for scheduled synchronization."
  },
  {
    key: "pageSize",
    label: "Page size",
    type: "number",
    description: "Requested page size for paginated source APIs."
  },
  {
    key: "cursorParam",
    label: "Cursor query parameter",
    type: "string",
    description: "Query parameter used for pagination cursors."
  }
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
  AGENTLESS: { version: "1.1", displayName: "Generic HTTP/HTTPS monitor", productStatus: "Available", requiredCapabilities: ["health_check"], supportedAuthMethods: ["NONE", "API_KEY", "BEARER", "BASIC", "CUSTOM_HEADER"], availableCapabilities: ["health_check", "latency"], configurationSchema: endpointFields, foundationHooks },
  HEARTBEAT: { version: "1.0", displayName: "Heartbeat ingest", productStatus: "Requires configuration", requiredCapabilities: ["heartbeat"], supportedAuthMethods: ["HMAC", "API_KEY"], availableCapabilities: ["heartbeat", "deployment_metadata"], configurationSchema: [], foundationHooks },
  WEBHOOK: { version: "1.0", displayName: "Signed webhook event ingest", productStatus: "Requires configuration", requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["HMAC"], availableCapabilities: ["event_ingest", "deployment_events"], configurationSchema: [], foundationHooks },
  API: { version: "1.1", displayName: "Generic REST/API check", productStatus: "Available", requiredCapabilities: ["api_probe"], supportedAuthMethods: ["NONE", "API_KEY", "BEARER", "BASIC", "CUSTOM_HEADER"], availableCapabilities: ["api_probe", "discovery"], configurationSchema: [...endpointFields, { key: "discoveryPath", label: "Discovery path", type: "string", description: "Optional GET path used for real response-key discovery." }], foundationHooks },
  METRICS_ALERTS_CONNECTOR: { version: "1.0", displayName: "Metrics & alerts connector", productStatus: "Preview", requiredCapabilities: ["monitoring_sync"], supportedAuthMethods: ["API_KEY", "BEARER", "CUSTOM_HEADER"], availableCapabilities: ["monitoring_sync", "metric_ingest", "alert_ingest", "event_ingest"], configurationSchema: monitoringConnectorFields, foundationHooks },
  APPLICATION_PERFORMANCE_CONNECTOR: { version: "1.0", displayName: "Application performance connector", productStatus: "Preview", requiredCapabilities: ["monitoring_sync"], supportedAuthMethods: ["API_KEY", "BEARER", "CUSTOM_HEADER"], availableCapabilities: ["monitoring_sync", "trace_ingest", "apm_ingest", "dependency_ingest"], configurationSchema: monitoringConnectorFields, foundationHooks },
  INFRASTRUCTURE_MONITORING_CONNECTOR: { version: "1.0", displayName: "Infrastructure monitoring connector", productStatus: "Preview", requiredCapabilities: ["monitoring_sync"], supportedAuthMethods: ["API_KEY", "BEARER", "CUSTOM_HEADER"], availableCapabilities: ["monitoring_sync", "service_health_ingest", "entity_ingest", "problem_ingest"], configurationSchema: monitoringConnectorFields, foundationHooks },
  SYNTHETIC: { version: "1.0", displayName: "Synthetic journey draft contract", productStatus: "Planned", requiredCapabilities: [], supportedAuthMethods: ["NONE"], availableCapabilities: [], configurationSchema: [], foundationHooks },
  OTEL_COLLECTOR: { version: "1.0", displayName: "OpenTelemetry collector ingest", productStatus: "Requires configuration", requiredCapabilities: ["telemetry_ingest"], supportedAuthMethods: ["API_KEY"], availableCapabilities: ["telemetry_ingest", "traces", "metrics", "logs"], configurationSchema: [{ key: "serviceName", label: "Expected service.name", type: "string", required: true, description: "Must exactly match the Collector resource service.name." }], foundationHooks },
  SDK: { version: "1.0", displayName: "SDK event ingest", productStatus: "Requires configuration", requiredCapabilities: ["event_ingest"], supportedAuthMethods: ["API_KEY", "HMAC"], availableCapabilities: ["event_ingest", "traces", "deployment_metadata"], configurationSchema: [], foundationHooks },
  CLOUD_CONNECTOR: { version: "1.0", displayName: "Cloud connector contract", productStatus: "Planned", requiredCapabilities: [], supportedAuthMethods: ["OAUTH2", "API_KEY"], availableCapabilities: [], configurationSchema: [], foundationHooks },
  DATABASE_CONNECTOR: { version: "1.0", displayName: "Database connector contract", productStatus: "Planned", requiredCapabilities: [], supportedAuthMethods: ["BASIC", "API_KEY", "MTLS"], availableCapabilities: [], configurationSchema: [], foundationHooks },
  CUSTOM_CONNECTOR: { version: "1.0", displayName: "Custom connector contract", productStatus: "Preview", requiredCapabilities: [], supportedAuthMethods: ["NONE", "API_KEY", "HMAC", "OAUTH2", "MTLS"], availableCapabilities: [], configurationSchema: [], foundationHooks }
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

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeAuthMethod = (value: unknown): string => {
  const normalized = String(value ?? "NONE").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "NO_AUTH") return "NONE";
  if (normalized === "APIKEY") return "API_KEY";
  if (normalized === "CUSTOM") return "CUSTOM_HEADER";
  return normalized;
};

const parseTimeout = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const coerced = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isInteger(coerced) || Number(coerced) < 1 || Number(coerced) > 30_000) {
    throw new Error("timeoutMs must be an integer between 1 and 30000");
  }
  return Number(coerced);
};

export const parseGuidedConnectionInput = (
  body: unknown,
  options: { partial?: boolean } = {}
): GuidedConnectionInput => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  const value = body as Record<string, unknown>;
  const legacy = value.configuration && typeof value.configuration === "object" && !Array.isArray(value.configuration)
    ? value.configuration as Record<string, unknown>
    : {};
  const connectorType = readString(value.connectorType) ?? readString(value.type) ?? (options.partial ? "" : "API");
  const normalizedConnectorType = connectorType.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const trueNumeris = normalizedConnectorType === "TRUENUMERIS";
  const monitoringModeByType: Record<string, ConnectionMode> = {
    METRICS_ALERTS: "METRICS_ALERTS_CONNECTOR",
    METRICSALERTS: "METRICS_ALERTS_CONNECTOR",
    METRICS_ALERTS_CONNECTOR: "METRICS_ALERTS_CONNECTOR",
    APPLICATION_PERFORMANCE: "APPLICATION_PERFORMANCE_CONNECTOR",
    APPLICATIONPERFORMANCE: "APPLICATION_PERFORMANCE_CONNECTOR",
    APPLICATION_PERFORMANCE_CONNECTOR: "APPLICATION_PERFORMANCE_CONNECTOR",
    INFRASTRUCTURE_MONITORING: "INFRASTRUCTURE_MONITORING_CONNECTOR",
    INFRASTRUCTUREMONITORING: "INFRASTRUCTURE_MONITORING_CONNECTOR",
    INFRASTRUCTURE_MONITORING_CONNECTOR: "INFRASTRUCTURE_MONITORING_CONNECTOR"
  };
  const monitoringMode = monitoringModeByType[normalizedConnectorType];
  const inferredMode = monitoringMode ?? (trueNumeris || normalizedConnectorType === "API" ? "API" : "AGENTLESS");
  const modeValue = (readString(value.mode) ?? inferredMode).toUpperCase();
  if (!isConnectionMode(modeValue)) throw new Error(`mode must be one of: ${CONNECTION_MODES.join(", ")}`);
  const baseUrl = readString(value.baseUrl) ?? readString(legacy.baseUrl);
  const healthPath = readString(value.healthPath) ?? readString(legacy.healthPath);
  const legacyEndpoint = readString(legacy.endpoint);
  const effectiveBaseUrl = baseUrl ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.baseUrl : undefined);
  const effectiveHealthPath = healthPath ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.healthPath : undefined);
  const endpoint = effectiveBaseUrl
    ? joinConnectionUrl(effectiveBaseUrl, effectiveHealthPath ?? "")
    : legacyEndpoint;
  const timeoutMs = parseTimeout(value.timeoutMs ?? legacy.timeoutMs);
  const requestMethod = String(value.requestMethod ?? legacy.requestMethod ?? legacy.method ?? "GET").toUpperCase();
  const authMethod = normalizeAuthMethod(value.authType ?? value.authMethod ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.authMethod : "NONE"));
  const configuration: Record<string, unknown> = {
    ...legacy,
    ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
    ...(effectiveHealthPath ? { healthPath: effectiveHealthPath } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(readString(value.discoveryPath) ?? readString(legacy.discoveryPath) ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.discoveryPath : undefined)
      ? { discoveryPath: readString(value.discoveryPath) ?? readString(legacy.discoveryPath) ?? TRUE_NUMERIS_PROFILE.discoveryPath }
      : {}),
    method: requestMethod,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(readString(value.authHeaderName) ?? readString(legacy.authHeaderName) ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.authHeaderName : undefined)
      ? { authHeaderName: readString(value.authHeaderName) ?? readString(legacy.authHeaderName) ?? TRUE_NUMERIS_PROFILE.authHeaderName }
      : {}),
    ...(readString(value.authPrefix) ?? readString(legacy.authPrefix) ?? (trueNumeris ? TRUE_NUMERIS_PROFILE.authPrefix : undefined)
      ? { authPrefix: readString(value.authPrefix) ?? readString(legacy.authPrefix) ?? TRUE_NUMERIS_PROFILE.authPrefix }
      : {})
  };
  if (isMonitoringConnectorMode(modeValue)) {
    const profile = resolveMonitoringProfile(modeValue, configuration);
    configuration.healthPath = readString(configuration.healthPath) ?? profile.defaultHealthPath;
    configuration.syncPath = readString(value.syncPath) ?? readString(legacy.syncPath) ?? profile.defaultSyncPath;
    configuration.pageSize = configuration.pageSize ?? profile.defaultPageSize;
    configuration.cursorParam = configuration.cursorParam ?? profile.cursorParam;
    if (effectiveBaseUrl) {
      configuration.endpoint = joinConnectionUrl(effectiveBaseUrl, String(configuration.healthPath));
    }
  }
  const defaultCapabilities = modeValue === "API"
    ? ["api_probe"]
    : modeValue === "AGENTLESS"
      ? ["health_check"]
      : isMonitoringConnectorMode(modeValue)
        ? ["monitoring_sync"]
        : [];
  return {
    projectId: readString(value.applicationId) ?? readString(value.projectId) ?? null,
    name: readString(value.name) ?? "",
    environment: readString(value.environment) ?? "production",
    type: connectorType,
    mode: modeValue,
    authMethod,
    ...(readString(value.authSecret) ? { authSecret: readString(value.authSecret) } : {}),
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === "string")
      : defaultCapabilities,
    configuration,
    ...(value.secretRef !== undefined ? { secretRef: readString(value.secretRef) ?? null } : {}),
    startMonitoring: value.startMonitoring === true
  };
};

export const joinConnectionUrl = (baseUrl: string, path: string): string => {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("baseUrl must be an HTTP or HTTPS URL");
  if (base.username || base.password) throw new Error("baseUrl must not contain credentials");
  const basePath = base.pathname.replace(/\/+$/, "");
  const childPath = path.trim().replace(/^\/+/, "");
  base.pathname = childPath ? `${basePath}/${childPath}`.replace(/\/{2,}/g, "/") : basePath || "/";
  base.search = "";
  base.hash = "";
  return base.toString();
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
  const endpointModes = [
    "AGENTLESS",
    "API",
    "METRICS_ALERTS_CONNECTOR",
    "APPLICATION_PERFORMANCE_CONNECTOR",
    "INFRASTRUCTURE_MONITORING_CONNECTOR"
  ];
  if (!endpointModes.includes(mode)) return { valid: true, value };

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
  const monitoringModes = [
    "METRICS_ALERTS_CONNECTOR",
    "APPLICATION_PERFORMANCE_CONNECTOR",
    "INFRASTRUCTURE_MONITORING_CONNECTOR"
  ];
  if (monitoringModes.includes(mode as string)) {
    if (typeof value.syncPath !== "string" || !value.syncPath.startsWith("/")) {
      return { valid: false, error: "configuration.syncPath must begin with /" };
    }
    if (
      value.pageSize !== undefined &&
      (!Number.isInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 1000)
    ) {
      return { valid: false, error: "configuration.pageSize must be an integer between 1 and 1000" };
    }
  }
  return { valid: true, value };
};
