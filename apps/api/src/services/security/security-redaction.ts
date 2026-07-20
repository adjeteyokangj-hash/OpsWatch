import { createHash } from "crypto";
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

const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+/g;

export type SecurityRedactionMeta = {
  fieldsRedacted: string[];
  truncated: boolean;
  ipTruncated: boolean;
  accountHashed: boolean;
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

export const hashAccountIdentifier = (organizationId: string, accountId: string): string =>
  createHash("sha256").update(`${organizationId}:${accountId}`).digest("hex").slice(0, 32);

/** Truncate IPv4 to /24 or IPv6 to /48 when privacy truncation is enabled. */
export const truncateIp = (ip: string | null | undefined, enabled = true): string | null => {
  if (!ip) return null;
  if (!enabled) return ip.slice(0, 64);
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return `${parts.slice(0, 3).join(":")}::`;
  }
  return ip.slice(0, 64);
};

export const hashDeviceSession = (organizationId: string, deviceOrSession: string): string =>
  createHash("sha256").update(`${organizationId}:device:${deviceOrSession}`).digest("hex").slice(0, 32);

const redactDeep = (
  value: unknown,
  path = "",
  meta: SecurityRedactionMeta
): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (SENSITIVE_FIELD.test(path.split(".").pop() || "") || SENSITIVE_FIELD_PARTIAL.test(path)) {
      meta.fieldsRedacted.push(path || "value");
      return "[REDACTED]";
    }
    const redacted = redactText(value);
    if (redacted !== value) meta.fieldsRedacted.push(path || "value");
    const max = path === "body" || path.endsWith(".body") ? MAX_BODY_LENGTH : MAX_ATTRIBUTE_VALUE_LENGTH;
    const truncated = truncate(redacted, max);
    if (truncated.length < redacted.length) meta.truncated = true;
    return truncated;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ATTRIBUTE_COUNT).map((item, index) =>
      redactDeep(item, path ? `${path}[${index}]` : `[${index}]`, meta)
    );
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ATTRIBUTE_COUNT);
    for (const [key, child] of entries) {
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_FIELD.test(key) || SENSITIVE_FIELD_PARTIAL.test(key)) {
        meta.fieldsRedacted.push(childPath);
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redactDeep(child, childPath, meta);
    }
    return out;
  }
  return null;
};

export const redactSecurityPayload = (
  payload: unknown
): { value: Record<string, unknown> | null; meta: SecurityRedactionMeta } => {
  const meta: SecurityRedactionMeta = {
    fieldsRedacted: [],
    truncated: false,
    ipTruncated: false,
    accountHashed: false
  };
  if (payload === null || payload === undefined) return { value: null, meta };
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { value: { value: redactDeep(payload, "value", meta) }, meta };
  }
  return {
    value: redactDeep(payload, "", meta) as Record<string, unknown>,
    meta
  };
};

export type PrivacyOptions = {
  truncateIp?: boolean;
  hashAccounts?: boolean;
};

export const applyPrivacyToIdentifiers = (
  organizationId: string,
  input: {
    accountIdentifier?: string | null;
    sourceIp?: string | null;
    deviceSessionId?: string | null;
  },
  options: PrivacyOptions = {}
): {
  accountIdentifierHash: string | null;
  sourceIpTruncated: string | null;
  deviceSessionHash: string | null;
  meta: Pick<SecurityRedactionMeta, "ipTruncated" | "accountHashed">;
} => {
  const truncateEnabled = options.truncateIp !== false;
  const hashEnabled = options.hashAccounts !== false;
  const sourceIpTruncated = truncateIp(input.sourceIp, truncateEnabled);
  const accountIdentifierHash =
    input.accountIdentifier && hashEnabled
      ? hashAccountIdentifier(organizationId, input.accountIdentifier)
      : input.accountIdentifier
        ? truncate(input.accountIdentifier, 64)
        : null;
  const deviceSessionHash = input.deviceSessionId
    ? hashDeviceSession(organizationId, input.deviceSessionId)
    : null;
  return {
    accountIdentifierHash,
    sourceIpTruncated,
    deviceSessionHash,
    meta: {
      ipTruncated: Boolean(input.sourceIp && truncateEnabled && sourceIpTruncated !== input.sourceIp),
      accountHashed: Boolean(input.accountIdentifier && hashEnabled)
    }
  };
};
