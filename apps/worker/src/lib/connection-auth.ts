import { createDecipheriv, createHash } from "crypto";

type ManagedConnectionSecret = {
  authMethod: string;
  secretRef: string | null;
  managedSecretCiphertext: string | null;
  managedSecretIv: string | null;
  managedSecretAuthTag: string | null;
  configurationJson: unknown;
};

const decryptManagedSecret = (connection: ManagedConnectionSecret): string | null => {
  if (!connection.managedSecretCiphertext || !connection.managedSecretIv || !connection.managedSecretAuthTag) {
    if (!connection.secretRef?.startsWith("env://")) return null;
    const name = connection.secretRef.slice("env://".length);
    return /^[A-Z][A-Z0-9_]*$/.test(name) ? process.env[name] ?? null : null;
  }
  const raw = process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!raw) throw new Error("A secrets encryption key is required for managed connection checks");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(raw).digest(),
    Buffer.from(connection.managedSecretIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(connection.managedSecretAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.managedSecretCiphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

export const connectionRequestHeaders = (connection: ManagedConnectionSecret): Record<string, string> => {
  if (connection.authMethod === "NONE") return {};
  const secret = decryptManagedSecret(connection);
  if (!secret) throw new Error("Managed connection credential is unavailable");
  const configuration = connection.configurationJson && typeof connection.configurationJson === "object"
    ? connection.configurationJson as Record<string, unknown>
    : {};
  const headerName = typeof configuration.authHeaderName === "string" ? configuration.authHeaderName : undefined;
  const prefix = typeof configuration.authPrefix === "string" ? configuration.authPrefix.trim() : undefined;
  if (connection.authMethod === "BEARER") return { Authorization: `${prefix || "Bearer"} ${secret}` };
  if (connection.authMethod === "BASIC") return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
  if (connection.authMethod === "API_KEY") return { [headerName || "X-API-Key"]: prefix ? `${prefix} ${secret}` : secret };
  if (connection.authMethod === "CUSTOM_HEADER" && headerName) return { [headerName]: prefix ? `${prefix} ${secret}` : secret };
  throw new Error("Unsupported managed connection authentication method");
};
