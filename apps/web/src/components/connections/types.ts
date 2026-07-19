export const CONNECTION_ENVIRONMENTS = ["dev", "test", "staging", "production"] as const;
export type ConnectionEnvironment = (typeof CONNECTION_ENVIRONMENTS)[number];

export const CONNECTION_METHODS = [
  { value: "REST_API", label: "REST API", mode: "API" },
  { value: "HEARTBEAT", label: "Heartbeat", mode: "HEARTBEAT" },
  { value: "WEBHOOK", label: "Webhook", mode: "WEBHOOK" },
  { value: "AGENTLESS", label: "Agentless URL", mode: "AGENTLESS" },
  { value: "SDK", label: "SDK", mode: "SDK" },
  { value: "OTEL", label: "OpenTelemetry", mode: "OTEL_COLLECTOR" },
  { value: "CLOUD", label: "Cloud", mode: "CLOUD_CONNECTOR" },
  { value: "DATABASE", label: "Database", mode: "DATABASE_CONNECTOR" },
  { value: "CUSTOM", label: "Custom", mode: "CUSTOM_CONNECTOR" }
] as const;

export type ConnectionMethodValue = (typeof CONNECTION_METHODS)[number]["value"];

export const AUTH_TYPES = [
  { value: "NONE", label: "None" },
  { value: "API_KEY", label: "API key" },
  { value: "BEARER", label: "Bearer" },
  { value: "BASIC", label: "Basic" },
  { value: "CUSTOM_HEADER", label: "Custom header" }
] as const;

export type AuthTypeValue = (typeof AUTH_TYPES)[number]["value"];

export const TIMEOUT_OPTIONS_SECONDS = [5, 10, 15, 30] as const;
export type TimeoutSeconds = (typeof TIMEOUT_OPTIONS_SECONDS)[number];

export type ProjectOption = { id: string; name: string };

export type ConnectionRecord = {
  id: string;
  name: string;
  type: string;
  mode: string;
  environment: string;
  authMethod: string;
  health: string;
  installationStatus?: string;
  project: ProjectOption | null;
  secretConfigured: boolean;
  lastError: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastValidatedAt?: string | null;
  validationLatencyMs?: number | null;
  validationStatusCode?: number | null;
  isActive: boolean;
  configuration?: Record<string, unknown> | null;
  capabilities?: string[];
  manifestVersion?: string;
  baseUrl?: string | null;
  healthPath?: string | null;
  discoveryPath?: string | null;
  connectorType?: string | null;
};

export type GuidedConnectionForm = {
  applicationId: string;
  name: string;
  environment: ConnectionEnvironment;
  method: ConnectionMethodValue;
  baseUrl: string;
  healthPath: string;
  discoveryPath: string;
  authType: AuthTypeValue;
  authSecret: string;
  authHeaderName: string;
  authPrefix: string;
  timeoutSeconds: TimeoutSeconds;
  requestMethod: string;
  /** Advanced overrides — optional for power users */
  advancedMode: string;
  advancedType: string;
  advancedAuthMethod: string;
  advancedHeaderName: string;
  advancedTimeoutMs: string;
  credentialReference: string;
  nameManuallyEdited: boolean;
};

export type GuidedConnectionDto = {
  applicationId: string;
  projectId: string;
  name: string;
  environment: string;
  connectorType: ConnectionMethodValue;
  mode: string;
  type: string;
  baseUrl?: string;
  healthPath?: string;
  discoveryPath?: string;
  authType: AuthTypeValue;
  authMethod: string;
  authSecret?: string;
  authHeaderName?: string;
  authPrefix?: string;
  timeoutMs: number;
  requestMethod?: string;
  secretRef?: string;
  startMonitoring?: boolean;
};

export type ConnectionTestResult = {
  /** Backend probe contract */
  succeeded: boolean;
  statusCode?: number | null;
  responseTimeMs?: number | null;
  error?: string | null;
  errorCategory?: string | null;
  authenticationPassed?: boolean | null;
  healthPassed?: boolean | null;
  discoveryPassed?: boolean | null;
  discoveredServices?: Array<string | { name?: string; id?: string }>;
  validatedAt?: string | null;
};

export const TRUE_NUMERIS_PROFILE = {
  name: "TrueNumeris Production",
  environment: "production" as ConnectionEnvironment,
  method: "REST_API" as ConnectionMethodValue,
  baseUrl: "https://api.truenumeris.com",
  healthPath: "/api/v1/health",
  authType: "BEARER" as AuthTypeValue,
  authHeaderName: "Authorization",
  authPrefix: "Bearer",
  discoveryPath: "/api/v1/integrations/ping"
} as const;

export const emptyGuidedForm = (applicationId = ""): GuidedConnectionForm => ({
  applicationId,
  name: "",
  environment: "production",
  method: "REST_API",
  baseUrl: "",
  healthPath: "/health",
  discoveryPath: "",
  authType: "NONE",
  authSecret: "",
  authHeaderName: "",
  authPrefix: "",
  timeoutSeconds: 10,
  requestMethod: "GET",
  advancedMode: "",
  advancedType: "",
  advancedAuthMethod: "",
  advancedHeaderName: "",
  advancedTimeoutMs: "",
  credentialReference: "",
  nameManuallyEdited: false
});
