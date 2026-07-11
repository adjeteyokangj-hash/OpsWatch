const PLACEHOLDER_PATTERNS = [
  /^$/,
  /changeme/i,
  /replace-?me/i,
  /your[-_]?/i,
  /opswatch-local/i,
  /localdevonly/i,
  /^postgres:postgres@/i
];

export const isPlaceholderSecret = (value: string | undefined): boolean => {
  if (!value?.trim()) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
};

export const assertProductionEnv = (): void => {
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  const weak: string[] = [];

  const requireVar = (key: string, minLength = 1) => {
    const value = process.env[key]?.trim();
    if (!value) {
      missing.push(key);
      return;
    }
    if (minLength > 1 && value.length < minLength) {
      weak.push(`${key} (min ${minLength} chars)`);
    }
    if (isPlaceholderSecret(value)) {
      weak.push(`${key} (placeholder or default value)`);
    }
  };

  requireVar("DATABASE_URL", 12);
  requireVar("JWT_SECRET", 32);
  requireVar("WORKER_INTERNAL_SECRET", 16);
  requireVar("OPSWATCH_WEB_URL", 8);

  if (missing.length > 0 || weak.length > 0) {
    const lines = [
      "Production startup blocked: invalid environment configuration.",
      ...(missing.length ? [`Missing: ${missing.join(", ")}`] : []),
      ...(weak.length ? [`Invalid: ${weak.join(", ")}`] : [])
    ];
    throw new Error(lines.join("\n"));
  }
};
