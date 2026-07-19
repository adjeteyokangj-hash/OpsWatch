import { createDecipheriv, createHash } from "crypto";
import { prisma } from "./prisma";

type ManagedConnectionSecret = {
  organizationId: string;
  authMethod: string;
  credentialFamilyId?: string | null;
  secretRef: string | null;
  managedSecretCiphertext: string | null;
  managedSecretIv: string | null;
  managedSecretAuthTag: string | null;
  configurationJson: unknown;
};

const ALGORITHM = "aes-256-gcm";
const CURRENT_KEY_VERSION = "v1";

const encryptionKey = (): Buffer => {
  const raw = process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!raw) throw new Error("A secrets encryption key is required for managed connection checks");
  return createHash("sha256").update(raw).digest();
};

const decryptLegacyManagedSecret = (connection: ManagedConnectionSecret): string | null => {
  if (!connection.managedSecretCiphertext || !connection.managedSecretIv || !connection.managedSecretAuthTag) {
    if (!connection.secretRef?.startsWith("env://")) return null;
    const name = connection.secretRef.slice("env://".length);
    return /^[A-Z][A-Z0-9_]*$/.test(name) ? process.env[name] ?? null : null;
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(connection.managedSecretIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(connection.managedSecretAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.managedSecretCiphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const buildAad = (input: {
  organizationId: string;
  purpose: string;
  familyId: string;
  version: number;
}): string => `${input.organizationId}:${input.purpose}:${input.familyId}:${input.version}`;

const decryptVersionedSecret = (payload: {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}, aad: string): string => {
  if (payload.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported managed credential key version: ${payload.keyVersion}`);
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const resolveManagedFamilySecret = async (connection: ManagedConnectionSecret): Promise<string | null> => {
  if (!connection.credentialFamilyId) return null;
  const now = new Date();
  const rows = await prisma.managedCredential.findMany({
    where: {
      organizationId: connection.organizationId,
      familyId: connection.credentialFamilyId,
      status: { in: ["ACTIVE", "GRACE"] }
    },
    orderBy: { version: "desc" }
  });

  for (const row of rows) {
    if (row.status === "ACTIVE" && row.expiresAt && row.expiresAt <= now) continue;
    if (row.status === "GRACE" && (!row.graceExpiresAt || row.graceExpiresAt <= now)) continue;
    return decryptVersionedSecret(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        keyVersion: row.keyVersion
      },
      buildAad({
        organizationId: row.organizationId,
        purpose: row.purpose,
        familyId: row.familyId,
        version: row.version
      })
    );
  }

  return null;
};

export const decryptManagedConnectionSecret = async (
  connection: ManagedConnectionSecret
): Promise<string | null> => {
  const managed = await resolveManagedFamilySecret(connection);
  if (managed) return managed;
  return decryptLegacyManagedSecret(connection);
};

export const connectionRequestHeaders = async (
  connection: ManagedConnectionSecret
): Promise<Record<string, string>> => {
  if (connection.authMethod === "NONE") return {};
  const secret = await decryptManagedConnectionSecret(connection);
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

/** Test-only helper to ensure AAD format stays aligned with API managed-credential service. */
export const __testOnlyBuildManagedCredentialAad = buildAad;
