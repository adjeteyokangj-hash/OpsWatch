import fs from "node:fs";
import path from "node:path";

export type EnvMap = Record<string, string>;

export const parseEnvFile = (filePath: string): EnvMap => {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const result: EnvMap = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
};

export const loadServiceEnv = (rootDir: string): { api: EnvMap; worker: EnvMap; web: EnvMap } => ({
  api: parseEnvFile(path.join(rootDir, "apps/api/.env")),
  worker: parseEnvFile(path.join(rootDir, "apps/worker/.env")),
  web: parseEnvFile(path.join(rootDir, "apps/web/.env.local"))
});

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /changeme/i,
  /replace-?me/i,
  /your[-_]?/i,
  /opswatch-local/i,
  /localdevonly/i,
  /example\.com$/i,
  /^postgres:postgres@/i
];

export const isPlaceholderSecret = (value: string | undefined): boolean => {
  if (!value?.trim()) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
};

export const redactValue = (value: string | undefined, secret = false): string => {
  if (!value?.trim()) return "(missing)";
  if (!secret) return value.trim();
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length} chars)`;
};

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
