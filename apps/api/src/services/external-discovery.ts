export const EXTERNAL_DISCOVERY_SCHEMA_VERSION = "1.0" as const;
export const EXTERNAL_DISCOVERY_MONITORING_MODE = "api-discovered" as const;

export type ExternalDiscoveryRegistryEntry = {
  key: string;
  enabled: true;
  endpoint: string;
  requiredScope?: string;
  category?: string;
  description?: string;
};

export type ParsedExternalDiscovery = {
  schemaVersion: typeof EXTERNAL_DISCOVERY_SCHEMA_VERSION;
  monitoringMode: typeof EXTERNAL_DISCOVERY_MONITORING_MODE;
  application?: {
    name?: string;
    environment?: string;
    version?: string;
    instanceId?: string;
  };
  capabilities: Record<string, boolean>;
  endpoints: Record<string, string>;
  registry: ExternalDiscoveryRegistryEntry[];
};

export class ExternalDiscoveryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalDiscoveryParseError";
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeEndpointPath = (key: string, raw: unknown): string => {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ExternalDiscoveryParseError(`endpoints.${key} must be a non-empty path string`);
  }
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    throw new ExternalDiscoveryParseError(`endpoints.${key} must be a same-origin path, not an absolute URL`);
  }
  if (!trimmed.startsWith("/")) {
    throw new ExternalDiscoveryParseError(`endpoints.${key} must begin with /`);
  }
  if (trimmed.includes("://") || trimmed.includes("\\")) {
    throw new ExternalDiscoveryParseError(`endpoints.${key} is not a safe path`);
  }
  return trimmed.split(/[?#]/, 1)[0] || trimmed;
};

/**
 * Parse a StarLiz-compatible external discovery document.
 * Only enabled capabilities with path endpoints are retained for polling.
 */
export const parseExternalDiscoveryDocument = (payload: unknown): ParsedExternalDiscovery => {
  if (!isPlainObject(payload)) {
    throw new ExternalDiscoveryParseError("Discovery response must be a JSON object");
  }
  if (payload.schemaVersion !== EXTERNAL_DISCOVERY_SCHEMA_VERSION) {
    throw new ExternalDiscoveryParseError(
      `Unsupported discovery schemaVersion (expected ${EXTERNAL_DISCOVERY_SCHEMA_VERSION})`
    );
  }
  if (payload.monitoringMode !== EXTERNAL_DISCOVERY_MONITORING_MODE) {
    throw new ExternalDiscoveryParseError(
      `Unsupported monitoringMode (expected ${EXTERNAL_DISCOVERY_MONITORING_MODE})`
    );
  }
  if (!isPlainObject(payload.capabilities)) {
    throw new ExternalDiscoveryParseError("Discovery capabilities must be an object of booleans");
  }
  if (!isPlainObject(payload.endpoints)) {
    throw new ExternalDiscoveryParseError("Discovery endpoints must be an object of path strings");
  }

  const capabilities: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(payload.capabilities)) {
    if (typeof value !== "boolean") {
      throw new ExternalDiscoveryParseError(`capabilities.${key} must be a boolean`);
    }
    capabilities[key] = value;
  }

  const endpoints: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.endpoints)) {
    if (!capabilities[key]) continue;
    endpoints[key] = normalizeEndpointPath(key, value);
  }

  for (const [key, enabled] of Object.entries(capabilities)) {
    if (enabled && !(key in endpoints)) {
      throw new ExternalDiscoveryParseError(`Enabled capability "${key}" is missing endpoints.${key}`);
    }
  }

  const registry: ExternalDiscoveryRegistryEntry[] = [];
  if (payload.registry !== undefined) {
    if (!Array.isArray(payload.registry)) {
      throw new ExternalDiscoveryParseError("Discovery registry must be an array when present");
    }
    for (const entry of payload.registry) {
      if (!isPlainObject(entry)) continue;
      const key = typeof entry.key === "string" ? entry.key : null;
      const endpoint = typeof entry.endpoint === "string" ? entry.endpoint : null;
      if (!key || !endpoint || entry.enabled !== true) continue;
      if (!capabilities[key]) continue;
      registry.push({
        key,
        enabled: true,
        endpoint: normalizeEndpointPath(key, endpoint),
        ...(typeof entry.requiredScope === "string" ? { requiredScope: entry.requiredScope } : {}),
        ...(typeof entry.category === "string" ? { category: entry.category } : {}),
        ...(typeof entry.description === "string" ? { description: entry.description } : {})
      });
    }
  }

  const application = isPlainObject(payload.application)
    ? {
      ...(typeof payload.application.name === "string" ? { name: payload.application.name } : {}),
      ...(typeof payload.application.environment === "string"
        ? { environment: payload.application.environment }
        : {}),
      ...(typeof payload.application.version === "string" ? { version: payload.application.version } : {}),
      ...(typeof payload.application.instanceId === "string"
        ? { instanceId: payload.application.instanceId }
        : {})
    }
    : undefined;

  return {
    schemaVersion: EXTERNAL_DISCOVERY_SCHEMA_VERSION,
    monitoringMode: EXTERNAL_DISCOVERY_MONITORING_MODE,
    ...(application && Object.keys(application).length ? { application } : {}),
    capabilities,
    endpoints,
    registry
  };
};

export const advertisedEndpointEntries = (
  discovery: ParsedExternalDiscovery
): Array<{ capability: string; path: string }> =>
  Object.entries(discovery.endpoints)
    .filter(([capability]) => discovery.capabilities[capability] === true)
    .map(([capability, path]) => ({ capability, path }));
