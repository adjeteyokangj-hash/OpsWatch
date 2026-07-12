const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|bearer|signing)/i;
const BEARER_PATTERN = /bearer\s+[a-z0-9._-]+/gi;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export const redactString = (value: string): string =>
  value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");

export const redactUnknown = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[TRUNCATED]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((row) => redactUnknown(row, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactUnknown(nested, depth + 1);
  }
  return output;
};

export const redactForPrompt = (value: unknown): string => JSON.stringify(redactUnknown(value));
