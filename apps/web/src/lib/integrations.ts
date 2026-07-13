export type IntegrationType =
  | "WEBHOOK"
  | "EMAIL"
  | "STRIPE"
  | "WORKER_PROVIDER"
  | "SERVICE_PROVIDER"
  | "DEPLOYMENT_PROVIDER"
  | "STATUS_PROVIDER"
  | "RUNBOOK_PROVIDER";

export type IntegrationValidationStatus = "UNKNOWN" | "VALID" | "INVALID";

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

export type ProjectIntegration = {
  id: string;
  projectId: string;
  type: IntegrationType | string;
  name: string | null;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  secretRef: string | null;
  validationStatus: IntegrationValidationStatus;
  validationMessage: string | null;
  validationDetails?: IntegrationValidationDetails | null;
  lastValidatedAt: string | null;
};

export type ProviderFieldKind = "secret" | "text" | "number" | "url";

export type ProviderField = {
  key: string;
  label: string;
  kind: ProviderFieldKind;
  placeholder?: string;
  required?: boolean;
  recommended?: boolean;
  defaultValue?: string | number;
};

export type ProviderFieldGroup = {
  credentials: ProviderField[];
  configuration: ProviderField[];
};

export const PROVIDER_PRESETS: Record<IntegrationType, Record<string, unknown>> = {
  WEBHOOK: {
    WEBHOOK_URL: "",
    WEBHOOK_TIMEOUT_MS: 5000,
    WEBHOOK_SIGNING_HEADER: "X-OpsWatch-Signature"
  },
  EMAIL: {
    EMAIL_PROVIDER_HEALTHCHECK_URL: "",
    EMAIL_FROM: "alerts@opswatch.app",
    EMAIL_REPLY_TO: ""
  },
  STRIPE: {
    STRIPE_API_KEY: "",
    STRIPE_API_BASE: "https://api.stripe.com",
    STRIPE_WEBHOOK_SECRET: ""
  },
  WORKER_PROVIDER: {
    WORKER_RESTART_WEBHOOK_URL: "",
    WORKER_PROVIDER_TIMEOUT_MS: 5000
  },
  SERVICE_PROVIDER: {
    SERVICE_RESTART_WEBHOOK_URL: "",
    SERVICE_PROVIDER_TIMEOUT_MS: 5000
  },
  DEPLOYMENT_PROVIDER: {
    DEPLOYMENT_ROLLBACK_WEBHOOK_URL: "",
    DEPLOYMENT_PROVIDER_TIMEOUT_MS: 5000
  },
  STATUS_PROVIDER: {
    PROVIDER_STATUS_URL: "",
    STATUS_PAGE_COMPONENT: "",
    STATUS_PAGE_ENV: ""
  },
  RUNBOOK_PROVIDER: {
    RUNBOOK_BASE_URL: "",
    RUNBOOK_DEFAULT_OWNER: "platform",
    RUNBOOK_TEMPLATE: "incident-standard"
  }
};

export const PROVIDER_FIELD_GROUPS: Record<IntegrationType, ProviderFieldGroup> = {
  STRIPE: {
    credentials: [
      { key: "STRIPE_API_KEY", label: "Secret key", kind: "secret", required: true, placeholder: "sk_test_..." },
      {
        key: "STRIPE_WEBHOOK_SECRET",
        label: "Webhook secret",
        kind: "secret",
        recommended: true,
        placeholder: "whsec_..."
      }
    ],
    configuration: [
      {
        key: "STRIPE_API_BASE",
        label: "API base",
        kind: "url",
        defaultValue: "https://api.stripe.com",
        placeholder: "https://api.stripe.com"
      }
    ]
  },
  WEBHOOK: {
    credentials: [],
    configuration: [
      { key: "WEBHOOK_URL", label: "Webhook URL", kind: "url", required: true, placeholder: "https://client.example.com/opswatch/webhook" },
      { key: "WEBHOOK_TIMEOUT_MS", label: "Timeout (ms)", kind: "number", defaultValue: 5000 },
      {
        key: "WEBHOOK_SIGNING_HEADER",
        label: "Signing header",
        kind: "text",
        defaultValue: "X-OpsWatch-Signature"
      }
    ]
  },
  EMAIL: {
    credentials: [],
    configuration: [
      {
        key: "EMAIL_PROVIDER_HEALTHCHECK_URL",
        label: "Health check URL",
        kind: "url",
        required: true,
        placeholder: "https://email-provider.example.com/health"
      },
      { key: "EMAIL_FROM", label: "From address", kind: "text", recommended: true, defaultValue: "alerts@opswatch.app" },
      { key: "EMAIL_REPLY_TO", label: "Reply-to address", kind: "text", placeholder: "oncall@example.com" }
    ]
  },
  WORKER_PROVIDER: {
    credentials: [],
    configuration: [
      {
        key: "WORKER_RESTART_WEBHOOK_URL",
        label: "Restart webhook URL",
        kind: "url",
        required: true
      },
      { key: "WORKER_PROVIDER_TIMEOUT_MS", label: "Timeout (ms)", kind: "number", defaultValue: 5000 }
    ]
  },
  SERVICE_PROVIDER: {
    credentials: [],
    configuration: [
      {
        key: "SERVICE_RESTART_WEBHOOK_URL",
        label: "Restart webhook URL",
        kind: "url",
        required: true
      },
      { key: "SERVICE_PROVIDER_TIMEOUT_MS", label: "Timeout (ms)", kind: "number", defaultValue: 5000 }
    ]
  },
  DEPLOYMENT_PROVIDER: {
    credentials: [],
    configuration: [
      {
        key: "DEPLOYMENT_ROLLBACK_WEBHOOK_URL",
        label: "Rollback webhook URL",
        kind: "url",
        required: true
      },
      { key: "DEPLOYMENT_PROVIDER_TIMEOUT_MS", label: "Timeout (ms)", kind: "number", defaultValue: 5000 }
    ]
  },
  STATUS_PROVIDER: {
    credentials: [],
    configuration: [
      { key: "PROVIDER_STATUS_URL", label: "Status URL", kind: "url", required: true },
      { key: "STATUS_PAGE_COMPONENT", label: "Status page component", kind: "text" },
      { key: "STATUS_PAGE_ENV", label: "Status page environment", kind: "text" }
    ]
  },
  RUNBOOK_PROVIDER: {
    credentials: [],
    configuration: [
      { key: "RUNBOOK_BASE_URL", label: "Runbook base URL", kind: "url", required: true },
      { key: "RUNBOOK_DEFAULT_OWNER", label: "Default owner", kind: "text", defaultValue: "platform" },
      { key: "RUNBOOK_TEMPLATE", label: "Runbook template", kind: "text", defaultValue: "incident-standard" }
    ]
  }
};

export const OPERATIONAL_INTEGRATION_TYPES: IntegrationType[] = [
  "WEBHOOK",
  "EMAIL",
  "WORKER_PROVIDER",
  "SERVICE_PROVIDER",
  "DEPLOYMENT_PROVIDER",
  "STATUS_PROVIDER",
  "RUNBOOK_PROVIDER"
];

export const PROVIDER_DISPLAY_NAMES: Record<IntegrationType, string> = {
  WEBHOOK: "Webhooks",
  EMAIL: "Email",
  STRIPE: "Stripe",
  WORKER_PROVIDER: "Automation Workers",
  SERVICE_PROVIDER: "Services",
  DEPLOYMENT_PROVIDER: "Deployment",
  STATUS_PROVIDER: "Status Pages",
  RUNBOOK_PROVIDER: "Runbooks"
};

export type ProjectOption = {
  id: string;
  name: string;
  slug: string;
};

export type ProjectIntegrationSummary = {
  projectId: string;
  total: number;
  connected: number;
  healthy: number;
  warnings: number;
  failed: number;
  notConfigured: number;
  overallIcon: string;
  overallLabel: string;
  attentionMessage?: string;
  lastValidatedAt: string | null;
};

export type OrganizationIntegrationSummary = {
  connected: number;
  requireAttention: number;
  failed: number;
  notConfiguredProjects: number;
  lastValidatedAt: string | null;
};

export const providerDisplayName = (provider: string): string =>
  PROVIDER_DISPLAY_NAMES[provider.toUpperCase() as IntegrationType] ?? providerTitle(provider);

export const providerTitle = (provider: string): string =>
  provider
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const formatRelativeTime = (value?: string | null): string => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export type ConnectionUiState = "not_configured" | "saved" | "testing" | "connected" | "failed" | "disabled";

export const resolveConnectionState = (
  integration: ProjectIntegration | null | undefined,
  validating = false
): ConnectionUiState => {
  if (validating) return "testing";
  if (!integration) return "not_configured";
  if (!integration.enabled) return "disabled";
  if (integration.validationStatus === "VALID") return "connected";
  if (integration.validationStatus === "INVALID") return "failed";
  if (integration.validationDetails?.connectionState === "saved") return "saved";
  const hasConfig = integration.configJson && Object.values(integration.configJson).some((value) => String(value ?? "").trim());
  return hasConfig ? "saved" : "not_configured";
};

export const connectionStateMeta: Record<
  ConnectionUiState,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; icon: string }
> = {
  not_configured: { label: "Not configured", tone: "neutral", icon: "⚪" },
  saved: { label: "Configuration saved", tone: "warning", icon: "🟡" },
  testing: { label: "Testing...", tone: "info", icon: "🔵" },
  connected: { label: "Connected", tone: "success", icon: "🟢" },
  failed: { label: "Connection failed", tone: "danger", icon: "🔴" },
  disabled: { label: "Disabled", tone: "neutral", icon: "⚪" }
};

export const healthLabel = (health?: IntegrationValidationDetails["health"]): string => {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "unhealthy":
      return "Unhealthy";
    default:
      return "Unknown";
  }
};

export const allProviderFields = (type: IntegrationType): ProviderField[] => {
  const group = PROVIDER_FIELD_GROUPS[type];
  return [...group.credentials, ...group.configuration];
};

export const readConfigField = (config: Record<string, unknown> | null | undefined, field: ProviderField): string => {
  const value = config?.[field.key];
  if (value === undefined || value === null || value === "") {
    return field.defaultValue !== undefined ? String(field.defaultValue) : "";
  }
  return String(value);
};

export const isFieldPresent = (config: Record<string, unknown> | null | undefined, field: ProviderField): boolean =>
  readConfigField(config, field).trim().length > 0;

export const maskSecretValue = (value: string): string => {
  if (!value) return "";
  return "•".repeat(Math.min(Math.max(value.length, 16), 24));
};

export const parseIntegrationType = (value: string): IntegrationType =>
  value.toUpperCase() as IntegrationType;

const latestTimestamp = (values: Array<string | null | undefined>): string | null => {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
};

export const summarizeProjectIntegrations = (
  projectId: string,
  integrations: ProjectIntegration[],
  types: IntegrationType[] = OPERATIONAL_INTEGRATION_TYPES
): ProjectIntegrationSummary => {
  const rows = types.map((type) => integrations.find((row) => row.projectId === projectId && row.type === type));
  let connected = 0;
  let healthy = 0;
  let warnings = 0;
  let failed = 0;
  let notConfigured = 0;
  let attentionMessage: string | undefined;

  for (let index = 0; index < types.length; index += 1) {
    const type = types[index]!;
    const row = rows[index];
    const state = resolveConnectionState(row);
    const health = row?.validationDetails?.health;

    if (state === "not_configured" || state === "disabled") {
      notConfigured += 1;
      continue;
    }
    if (state === "connected") {
      connected += 1;
      if (health === "healthy") healthy += 1;
      else if (health === "degraded") {
        warnings += 1;
        attentionMessage ||= `${providerDisplayName(type)} degraded`;
      } else if (health === "unhealthy") {
        failed += 1;
        attentionMessage ||= `${providerDisplayName(type)} unhealthy`;
      } else {
        healthy += 1;
      }
      continue;
    }
    if (state === "failed") {
      failed += 1;
      attentionMessage ||= `${providerDisplayName(type)} failed`;
      continue;
    }
    warnings += 1;
    attentionMessage ||= `${providerDisplayName(type)} needs validation`;
  }

  const configuredCount = types.length - notConfigured;
  let overallIcon = "⚪";
  let overallLabel = "Not configured";
  if (configuredCount === 0) {
    overallIcon = "⚪";
    overallLabel = "Not configured";
  } else if (failed > 0) {
    overallIcon = "🔴";
    overallLabel = `${connected} connected`;
  } else if (warnings > 0 || connected < configuredCount) {
    overallIcon = "🟡";
    overallLabel = `${connected} connected`;
  } else if (healthy === types.length || connected === types.length) {
    overallIcon = "🟢";
    overallLabel = `${connected} / ${types.length} healthy`;
  } else {
    overallIcon = "🟡";
    overallLabel = `${connected} connected`;
  }

  return {
    projectId,
    total: types.length,
    connected,
    healthy,
    warnings,
    failed,
    notConfigured,
    overallIcon,
    overallLabel,
    attentionMessage,
    lastValidatedAt: latestTimestamp(rows.map((row) => row?.lastValidatedAt))
  };
};

export const summarizeOrganizationIntegrations = (
  projects: ProjectOption[],
  integrations: ProjectIntegration[]
): OrganizationIntegrationSummary => {
  let connected = 0;
  let requireAttention = 0;
  let failed = 0;
  let notConfiguredProjects = 0;
  const validationTimes: Array<string | null> = [];

  for (const project of projects) {
    const summary = summarizeProjectIntegrations(project.id, integrations);
    connected += summary.connected;
    requireAttention += summary.warnings;
    failed += summary.failed;
    if (summary.notConfigured === summary.total) notConfiguredProjects += 1;
    validationTimes.push(summary.lastValidatedAt);
  }

  return {
    connected,
    requireAttention,
    failed,
    notConfiguredProjects,
    lastValidatedAt: latestTimestamp(validationTimes)
  };
};

export const integrationProviderPath = (projectId: string, type: IntegrationType): string =>
  `/projects/${projectId}/integrations/${type.toLowerCase()}`;

export const integrationTileStatus = (
  integration: ProjectIntegration | undefined,
  validating = false
): { icon: string; label: string; tone: ConnectionUiState } => {
  const state = resolveConnectionState(integration, validating);
  const meta = connectionStateMeta[state];
  if (state === "connected") {
    const health = integration?.validationDetails?.health;
    if (health === "healthy") return { icon: "🟢", label: "Healthy", tone: state };
    if (health === "degraded") return { icon: "🟡", label: "Degraded", tone: state };
    if (health === "unhealthy") return { icon: "🔴", label: "Unhealthy", tone: state };
    return { icon: meta.icon, label: "Connected", tone: state };
  }
  return { icon: meta.icon, label: meta.label, tone: state };
};
