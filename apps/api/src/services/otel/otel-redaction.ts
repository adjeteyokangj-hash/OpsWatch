const SENSITIVE_ATTRIBUTE =
  /(authorization|cookie|password|secret|token|api.?key|credential|session|jwt|email|phone|address|private.?key)/i;

const RESOURCE_ATTRIBUTE_ALLOWLIST = new Set([
  "service.name",
  "service.version",
  "service.namespace",
  "deployment.environment",
  "host.name",
  "host.id",
  "container.id",
  "container.name",
  "k8s.cluster.name",
  "k8s.namespace.name",
  "k8s.pod.name",
  "cloud.provider",
  "cloud.region",
  "faas.name",
  "faas.id",
  "db.system",
  "db.name",
  "messaging.system",
  "peer.service",
  "server.address",
  "server.port"
]);

const SIGNAL_ATTRIBUTE_ALLOWLIST =
  /^(http\.(request|response|route|method|status_code)|rpc\.(system|service|method)|db\.(system|name|operation|statement)|messaging\.(system|operation|destination\.name)|error\.(type|message)|exception\.(type|message)|otel\.status_code|server\.address|server\.port|url\.scheme|peer\.service|net\.peer\.(name|port)|span\.kind)$/;

const SENSITIVE_VALUE_PATTERN =
  /((?:authorization|cookie|api[_-]?key|password|secret|token|bearer)\s*[:=]\s*)([^\s,;]+)|(postgres(?:ql)?:\/\/[^\s]+)|(mysql:\/\/[^\s]+)|(mongodb(?:\+srv)?:\/\/[^\s]+)|(redis:\/\/[^\s]+)/gi;

export const MAX_ATTRIBUTE_COUNT = 32;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 512;
export const MAX_BODY_LENGTH = 1_024;

const truncate = (value: string, max = MAX_ATTRIBUTE_VALUE_LENGTH): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const sanitizeAttributeValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === "string") return truncate(redactSensitiveText(value));
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
};

export const redactSensitiveText = (value: string): string =>
  value.replace(SENSITIVE_VALUE_PATTERN, (match, label: string | undefined) => {
    if (label) return `${label}[REDACTED]`;
    return "[REDACTED_URL]";
  });

export const redactOtelAttributes = (
  attributes: Record<string, unknown> | undefined,
  allowed: (key: string) => boolean
): Record<string, string | number | boolean | null> => {
  if (!attributes) return {};
  return Object.entries(attributes)
    .filter(([key]) => !SENSITIVE_ATTRIBUTE.test(key) && allowed(key))
    .slice(0, MAX_ATTRIBUTE_COUNT)
    .reduce<Record<string, string | number | boolean | null>>((result, [key, value]) => {
      result[key] = sanitizeAttributeValue(value);
      return result;
    }, {});
};

export const isResourceAttributeAllowed = (key: string): boolean =>
  RESOURCE_ATTRIBUTE_ALLOWLIST.has(key);

export const isSignalAttributeAllowed = (key: string): boolean =>
  SIGNAL_ATTRIBUTE_ALLOWLIST.test(key);

export const redactLogBody = (body: string | undefined): string | undefined => {
  if (!body) return undefined;
  return truncate(redactSensitiveText(body), MAX_BODY_LENGTH);
};

export const sanitizeAuditMetadata = (
  metadata: Record<string, unknown>
): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_ATTRIBUTE.test(key)) {
      next[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string") {
      next[key] = redactSensitiveText(value);
      continue;
    }
    next[key] = value;
  }
  return next;
};
