import {
  AUTH_TYPES,
  CONNECTION_METHODS,
  TRUE_NUMERIS_PROFILE,
  emptyGuidedForm,
  type AuthTypeValue,
  type ConnectionMethodValue,
  type ConnectionRecord,
  type GuidedConnectionDto,
  type GuidedConnectionForm,
  type ProjectOption,
  type TimeoutSeconds
} from "./types";

export const timeoutSecondsToMs = (seconds: TimeoutSeconds | number): number => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 10_000;
  return Math.round(value * 1000);
};

export const isRestMethod = (method: ConnectionMethodValue): boolean =>
  method === "REST_API" ||
  method === "AGENTLESS" ||
  method === "METRICS_ALERTS" ||
  method === "APPLICATION_PERFORMANCE" ||
  method === "INFRASTRUCTURE_MONITORING";

export const isMonitoringMethod = (method: ConnectionMethodValue): boolean =>
  method === "METRICS_ALERTS" ||
  method === "APPLICATION_PERFORMANCE" ||
  method === "INFRASTRUCTURE_MONITORING";

export const methodLabel = (method: ConnectionMethodValue | string): string =>
  CONNECTION_METHODS.find((row) => row.value === method || row.mode === method)?.label ?? method;

export const connectionProductStatus = (
  method: ConnectionMethodValue | string
): "Available" | "Preview" | "Planned" | "Requires configuration" =>
  CONNECTION_METHODS.find((row) => row.value === method || row.mode === method)?.productStatus ?? "Preview";

export const methodToMode = (method: ConnectionMethodValue): string =>
  CONNECTION_METHODS.find((row) => row.value === method)?.mode ?? "API";

export const modeToMethod = (mode: string): ConnectionMethodValue => {
  const match = CONNECTION_METHODS.find((row) => row.mode === mode || row.value === mode);
  return match?.value ?? "REST_API";
};

export const authTypeLabel = (authType: AuthTypeValue | string): string =>
  AUTH_TYPES.find((row) => row.value === authType)?.label ?? authType;

export const authRequiresSecret = (authType: AuthTypeValue): boolean => authType !== "NONE";

export const authShowsHeaderName = (authType: AuthTypeValue): boolean =>
  authType === "API_KEY" || authType === "CUSTOM_HEADER";

export const authShowsPrefix = (authType: AuthTypeValue): boolean =>
  authType === "BEARER" || authType === "API_KEY" || authType === "CUSTOM_HEADER";

export const isTrueNumerisApplication = (name: string | null | undefined): boolean =>
  Boolean(name && name.trim().toLowerCase() === "truenumeris");

export const defaultConnectionName = (appName: string, environment: string): string => {
  const trimmed = appName.trim();
  if (!trimmed) return "";
  const envLabel = environment === "dev" ? "Development" : environment.charAt(0).toUpperCase() + environment.slice(1);
  return `${trimmed} ${envLabel}`;
};

export const applyTrueNumerisPrefill = (form: GuidedConnectionForm): GuidedConnectionForm => ({
  ...form,
  name: TRUE_NUMERIS_PROFILE.name,
  environment: TRUE_NUMERIS_PROFILE.environment,
  method: TRUE_NUMERIS_PROFILE.method,
  baseUrl: TRUE_NUMERIS_PROFILE.baseUrl,
  healthPath: TRUE_NUMERIS_PROFILE.healthPath,
  discoveryPath: TRUE_NUMERIS_PROFILE.discoveryPath,
  authType: TRUE_NUMERIS_PROFILE.authType,
  authHeaderName: TRUE_NUMERIS_PROFILE.authHeaderName,
  authPrefix: TRUE_NUMERIS_PROFILE.authPrefix,
  nameManuallyEdited: true
});

export const applyApplicationSelection = (
  form: GuidedConnectionForm,
  applicationId: string,
  projects: ProjectOption[]
): GuidedConnectionForm => {
  const project = projects.find((row) => row.id === applicationId);
  let next: GuidedConnectionForm = {
    ...form,
    applicationId
  };

  if (project && isTrueNumerisApplication(project.name)) {
    return applyTrueNumerisPrefill(next);
  }

  if (!next.nameManuallyEdited) {
    next = {
      ...next,
      name: defaultConnectionName(project?.name ?? "", next.environment)
    };
  }

  return next;
};

export const applyEnvironmentChange = (
  form: GuidedConnectionForm,
  environment: GuidedConnectionForm["environment"],
  projects: ProjectOption[]
): GuidedConnectionForm => {
  const project = projects.find((row) => row.id === form.applicationId);
  const next: GuidedConnectionForm = { ...form, environment };
  if (next.nameManuallyEdited) return next;
  return {
    ...next,
    name: defaultConnectionName(project?.name ?? "", environment)
  };
};

export const clearAuthSecret = (form: GuidedConnectionForm): GuidedConnectionForm => ({
  ...form,
  authSecret: ""
});

export const resolveTimeoutMs = (form: GuidedConnectionForm): number => {
  const advanced = form.advancedTimeoutMs.trim();
  if (advanced) {
    const parsed = Number(advanced);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 30_000) return parsed;
  }
  return timeoutSecondsToMs(form.timeoutSeconds);
};

export const buildGuidedConnectionPayload = (
  form: GuidedConnectionForm,
  options?: { startMonitoring?: boolean; includeSecret?: boolean }
): GuidedConnectionDto => {
  const mode = form.advancedMode.trim() || methodToMode(form.method);
  const authType = (form.advancedAuthMethod.trim() as AuthTypeValue) || form.authType;
  const authHeaderName =
    form.advancedHeaderName.trim() ||
    form.authHeaderName.trim() ||
    (authType === "BEARER" ? "Authorization" : undefined);
  const authPrefix =
    form.authPrefix.trim() ||
    (authType === "BEARER" ? "Bearer" : undefined);
  const type = form.advancedType.trim() || methodLabel(form.method);
  const timeoutMs = resolveTimeoutMs(form);
  const includeSecret = options?.includeSecret !== false;

  const payload: GuidedConnectionDto = {
    applicationId: form.applicationId,
    projectId: form.applicationId,
    name: form.name.trim(),
    environment: form.environment,
    connectorType: form.method,
    mode,
    type,
    authType,
    authMethod: authType,
    timeoutMs,
    startMonitoring: options?.startMonitoring ?? false
  };

  if (isRestMethod(form.method) || form.baseUrl.trim()) {
    payload.baseUrl = form.baseUrl.trim();
    payload.healthPath = form.healthPath.trim() || undefined;
    payload.discoveryPath = form.discoveryPath.trim() || undefined;
    payload.syncPath = form.syncPath.trim() || undefined;
    payload.requestMethod = form.requestMethod.trim() || "GET";
  }

  if (authHeaderName) payload.authHeaderName = authHeaderName;
  if (authPrefix) payload.authPrefix = authPrefix;
  if (includeSecret && form.authSecret.trim()) payload.authSecret = form.authSecret;
  if (form.credentialReference.trim()) payload.secretRef = form.credentialReference.trim();

  return payload;
};

export const hostFromBaseUrl = (baseUrl: string | null | undefined): string => {
  if (!baseUrl) return "—";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//i, "").split("/")[0] || baseUrl;
  }
};

export const configurationString = (
  configuration: Record<string, unknown> | null | undefined,
  key: string
): string => {
  const value = configuration?.[key];
  return typeof value === "string" ? value : "";
};

export const connectionFromRecord = (row: ConnectionRecord): GuidedConnectionForm => {
  const configuration = row.configuration ?? {};
  const baseUrl = row.baseUrl || configurationString(configuration, "baseUrl") || configurationString(configuration, "endpoint");
  const healthPath = row.healthPath || configurationString(configuration, "healthPath") || "/health";
  const discoveryPath = row.discoveryPath || configurationString(configuration, "discoveryPath");
  const syncPath = configurationString(configuration, "syncPath");
  const timeoutRaw = configuration.timeoutMs;
  const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : Number(timeoutRaw);
  const timeoutSeconds = ([5, 10, 15, 30] as const).includes((timeoutMs / 1000) as TimeoutSeconds)
    ? ((timeoutMs / 1000) as TimeoutSeconds)
    : 10;
  const authType = (AUTH_TYPES.find((rowAuth) => rowAuth.value === row.authMethod)?.value ??
    (row.authMethod === "API_KEY" ? "API_KEY" : "NONE")) as AuthTypeValue;

  return {
    ...emptyGuidedForm(row.project?.id ?? ""),
    applicationId: row.project?.id ?? "",
    name: row.name,
    environment: (["dev", "test", "staging", "production"].includes(row.environment)
      ? row.environment
      : row.environment === "development"
        ? "dev"
        : "production") as GuidedConnectionForm["environment"],
    method: modeToMethod(row.connectorType || row.mode),
    baseUrl,
    healthPath,
    discoveryPath,
    syncPath,
    authType,
    authSecret: "",
    authHeaderName: configurationString(configuration, "authHeaderName"),
    authPrefix: configurationString(configuration, "authPrefix"),
    timeoutSeconds,
    requestMethod: configurationString(configuration, "method") || "GET",
    advancedMode: row.mode,
    advancedType: row.type,
    advancedAuthMethod: row.authMethod,
    advancedHeaderName: configurationString(configuration, "authHeaderName"),
    advancedTimeoutMs: Number.isFinite(timeoutMs) ? String(timeoutMs) : "",
    credentialReference: "",
    nameManuallyEdited: true
  };
};

export const discoveredServiceNames = (
  services: ConnectionTestResultServices | undefined
): string[] => {
  if (!Array.isArray(services)) return [];
  return services
    .map((row) => (typeof row === "string" ? row : row?.name || row?.id || ""))
    .filter(Boolean);
};

type ConnectionTestResultServices = Array<string | { name?: string; id?: string }> | undefined;

export const formatLatency = (latencyMs: number | null | undefined): string => {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return "—";
  return `${Math.round(latencyMs)} ms`;
};

export const connectionTestPassed = (result: { succeeded?: boolean } | null | undefined): boolean =>
  Boolean(result?.succeeded === true);

export const connectionTestMessage = (result: {
  error?: string | null;
  errorCategory?: string | null;
} | null | undefined): string =>
  result?.error || result?.errorCategory || "Connection test did not succeed.";
