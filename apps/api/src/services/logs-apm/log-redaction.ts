import {
  MAX_ATTRIBUTE_COUNT,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_BODY_LENGTH,
  redactSensitiveText
} from "../otel/otel-redaction";

const SENSITIVE_FIELD =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|webhook[_-]?secret|connection[_-]?string|session[_-]?id|ssn|credit[_-]?card|card[_-]?number|cvv|pin)$/i;

const SENSITIVE_FIELD_PARTIAL =
  /(authorization|cookie|password|secret|token|api.?key|credential|session|private.?key|webhook|connection.?string|credit.?card|card.?number)/i;

const SENSITIVE_VALUE_PATTERN =
  /((?:authorization|cookie|api[_-]?key|password|passwd|secret|token|bearer)\s*[:=]\s*)(?:bearer\s+)?([^\s,;]+)|(postgres(?:ql)?:\/\/[^\s]+)|(mysql:\/\/[^\s]+)|(mongodb(?:\+srv)?:\/\/[^\s]+)|(redis:\/\/[^\s]+)/gi;

/** Basic payment-card pattern (13–19 digits with optional separators). */
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+/g;

export type RedactionMeta = {
  fieldsRedacted: string[];
  bodyRedacted: boolean;
  truncated: boolean;
  attributeCount: number;
};

const truncate = (value: string, max = MAX_ATTRIBUTE_VALUE_LENGTH): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const redactText = (value: string): string => {
  let next = redactSensitiveText(value);
  next = next.replace(SENSITIVE_VALUE_PATTERN, (match, label: string | undefined) => {
    if (label) return `${label}[REDACTED]`;
    return "[REDACTED_URL]";
  });
  next = next.replace(JWT_PATTERN, "[REDACTED_JWT]");
  next = next.replace(PAYMENT_CARD_PATTERN, "[REDACTED_CARD]");
  return next;
};

const isBinaryOrMalformed = (value: unknown): boolean => {
  if (typeof value === "string" && value.includes("\u0000")) return true;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return true;
  return false;
};

/**
 * Recursively redact objects before persistence.
 * Never retains original secret values in metadata.
 */
export const redactDeep = (
  value: unknown,
  path = "",
  meta: RedactionMeta = { fieldsRedacted: [], bodyRedacted: false, truncated: false, attributeCount: 0 }
): { value: unknown; meta: RedactionMeta } => {
  if (value === null || value === undefined) return { value: null, meta };
  if (isBinaryOrMalformed(value)) {
    meta.fieldsRedacted.push(path || "binary");
    return { value: "[REDACTED_BINARY]", meta };
  }
  if (typeof value === "string") {
    const redacted = redactText(value);
    if (redacted !== value) {
      if (path === "body" || path.endsWith(".body")) meta.bodyRedacted = true;
      else meta.fieldsRedacted.push(path || "value");
    }
    const truncated = truncate(redacted, path === "body" ? MAX_BODY_LENGTH : MAX_ATTRIBUTE_VALUE_LENGTH);
    if (truncated.length < redacted.length) meta.truncated = true;
    return { value: truncated, meta };
  }
  if (typeof value === "number" || typeof value === "boolean") return { value, meta };
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ATTRIBUTE_COUNT).map((item, index) => {
      const child = redactDeep(item, path ? `${path}[${index}]` : `[${index}]`, meta);
      return child.value;
    });
    return { value: items, meta };
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_ATTRIBUTE_COUNT) {
        meta.truncated = true;
        break;
      }
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_FIELD.test(key) || SENSITIVE_FIELD_PARTIAL.test(key)) {
        result[key] = "[REDACTED]";
        meta.fieldsRedacted.push(childPath);
        count += 1;
        continue;
      }
      const nested = redactDeep(child, childPath, meta);
      result[key] = nested.value;
      count += 1;
    }
    meta.attributeCount = Math.max(meta.attributeCount, count);
    return { value: result, meta };
  }
  return { value: null, meta };
};

export const redactLogPayload = (input: {
  body?: string;
  attributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}): {
  body?: string;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  redactionStatus: "REDACTED" | "CLEAN";
  redactionMeta: RedactionMeta;
} => {
  const meta: RedactionMeta = {
    fieldsRedacted: [],
    bodyRedacted: false,
    truncated: false,
    attributeCount: 0
  };
  const bodyResult = input.body !== undefined ? redactDeep(input.body, "body", meta) : null;
  const attrs = redactDeep(input.attributes ?? {}, "attributes", meta);
  const resource = redactDeep(input.resourceAttributes ?? {}, "resource", meta);
  const redactionStatus =
    meta.fieldsRedacted.length > 0 || meta.bodyRedacted || meta.truncated ? "REDACTED" : "CLEAN";
  return {
    body: typeof bodyResult?.value === "string" ? bodyResult.value : undefined,
    attributes: (attrs.value as Record<string, unknown>) ?? {},
    resourceAttributes: (resource.value as Record<string, unknown>) ?? {},
    redactionStatus,
    redactionMeta: {
      fieldsRedacted: [...new Set(meta.fieldsRedacted)].slice(0, 32),
      bodyRedacted: meta.bodyRedacted,
      truncated: meta.truncated,
      attributeCount: meta.attributeCount
    }
  };
};

export const assertNoSecrets = (value: unknown, label = "value"): void => {
  const serialized = JSON.stringify(value) ?? "";
  const lower = serialized.toLowerCase();
  const forbidden = [
    "eyjhbGcioijiuz",
    "password=super",
    "password=hunter",
    "sk_live_",
    "whsec_",
    "-----begin private key-----"
  ];
  for (const token of forbidden) {
    if (lower.includes(token)) {
      throw new Error(`Secret material leaked in ${label}`);
    }
  }
};
