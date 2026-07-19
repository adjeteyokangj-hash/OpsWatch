import type { Connection } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../lib/secret-crypto";
import { resolveConnectionSecretReference } from "../agentless-connection.service";
import {
  createCredentialVersion,
  markCredentialFailure,
  markCredentialSuccess,
  resolveActiveSecrets,
  rotateCredential,
  toCredentialMetadataDto,
  type CredentialMetadataDto,
  type CredentialType,
  type ResolvedCredentialSecret
} from "./managed-credential.service";

export type ConnectionCredentialDisplayStatus =
  | "Active"
  | "Expiring soon"
  | "Expired"
  | "Revoked"
  | "Rotation pending"
  | "Connection failed";

export type ConnectionSecretSource = Pick<
  Connection,
  | "organizationId"
  | "credentialFamilyId"
  | "secretRef"
  | "managedSecretCiphertext"
  | "managedSecretIv"
  | "managedSecretAuthTag"
>;

export type ConnectionCredentialDto = {
  secretConfigured: boolean;
  hasSecretReference: boolean;
  credentialType: string | null;
  environment: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  status: ConnectionCredentialDisplayStatus | null;
  version: number | null;
  keyVersion: string | null;
};

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export const connectionCredentialType = (authMethod: string): CredentialType => {
  switch (authMethod.toUpperCase()) {
    case "BEARER":
      return "BEARER_TOKEN";
    case "API_KEY":
      return "API_KEY";
    case "HMAC":
      return "HMAC_SECRET";
    default:
      return "STATIC_KEY";
  }
};

const decryptLegacyManagedSecret = (connection: ConnectionSecretSource): string | null => {
  if (
    !connection.managedSecretCiphertext ||
    !connection.managedSecretIv ||
    !connection.managedSecretAuthTag
  ) {
    return null;
  }
  return decryptSecret({
    ciphertext: connection.managedSecretCiphertext,
    iv: connection.managedSecretIv,
    authTag: connection.managedSecretAuthTag
  });
};

export const computeCredentialDisplayStatus = (
  metadata: CredentialMetadataDto | null,
  connection?: {
    health?: string | null;
    lastSuccessAt?: Date | string | null;
    lastFailureAt?: Date | string | null;
  }
): ConnectionCredentialDisplayStatus | null => {
  if (!metadata?.configured) return null;
  const now = Date.now();
  const lastSuccess = connection?.lastSuccessAt ? new Date(connection.lastSuccessAt).getTime() : null;
  const lastFailure = connection?.lastFailureAt ? new Date(connection.lastFailureAt).getTime() : null;

  if (metadata.status === "REVOKED") return "Revoked";
  if (metadata.status === "EXPIRED" || (metadata.expiresAt && metadata.expiresAt.getTime() <= now)) {
    return "Expired";
  }
  if (metadata.status === "GRACE") return "Rotation pending";
  if (
    (connection?.health === "DEGRADED" || connection?.health === "DISCONNECTED") &&
    lastFailure &&
    (!lastSuccess || lastFailure > lastSuccess)
  ) {
    return "Connection failed";
  }
  if (metadata.expiresAt && metadata.expiresAt.getTime() - now <= EXPIRING_SOON_MS) {
    return "Expiring soon";
  }
  return "Active";
};

export const toConnectionCredentialDto = (
  row: ConnectionSecretSource & {
    authMethod?: string;
    environment?: string;
    health?: string | null;
    lastSuccessAt?: Date | string | null;
    lastFailureAt?: Date | string | null;
  },
  metadata: CredentialMetadataDto | null
): ConnectionCredentialDto => {
  const legacyConfigured = Boolean(
    row.managedSecretCiphertext && row.managedSecretIv && row.managedSecretAuthTag
  );
  const secretConfigured = Boolean(metadata?.configured || legacyConfigured || row.secretRef);
  const lastTestedAt = metadata?.lastSuccessAt ?? metadata?.lastFailureAt ?? metadata?.lastUsedAt ?? null;

  return {
    secretConfigured,
    hasSecretReference: Boolean(row.secretRef),
    credentialType: metadata?.type ?? (row.authMethod ? connectionCredentialType(row.authMethod) : null),
    environment: metadata?.environment ?? row.environment ?? null,
    createdAt: metadata?.createdAt?.toISOString() ?? null,
    expiresAt: metadata?.expiresAt?.toISOString() ?? null,
    lastUsedAt: metadata?.lastUsedAt?.toISOString() ?? null,
    lastTestedAt: lastTestedAt?.toISOString() ?? null,
    lastSuccessAt: metadata?.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: metadata?.lastFailureAt?.toISOString() ?? null,
    status: computeCredentialDisplayStatus(metadata, row),
    version: metadata?.version ?? null,
    keyVersion: metadata?.keyVersion ?? null
  };
};

export const fetchActiveCredentialMetadata = async (
  organizationId: string,
  familyId: string | null | undefined
): Promise<CredentialMetadataDto | null> => {
  if (!familyId) return null;
  const row = await prisma.managedCredential.findFirst({
    where: {
      organizationId,
      familyId,
      status: { in: ["ACTIVE", "GRACE"] }
    },
    orderBy: { version: "desc" }
  });
  return toCredentialMetadataDto(row);
};

export const fetchActiveCredentialMetadataBatch = async (
  organizationId: string,
  familyIds: string[]
): Promise<Map<string, CredentialMetadataDto>> => {
  if (familyIds.length === 0) return new Map();
  const rows = await prisma.managedCredential.findMany({
    where: {
      organizationId,
      familyId: { in: familyIds },
      status: { in: ["ACTIVE", "GRACE"] }
    },
    orderBy: { version: "desc" }
  });
  const map = new Map<string, CredentialMetadataDto>();
  for (const row of rows) {
    if (!map.has(row.familyId)) {
      const dto = toCredentialMetadataDto(row);
      if (dto) map.set(row.familyId, dto);
    }
  }
  return map;
};

export const upsertConnectionCredential = async (input: {
  organizationId: string;
  connectionId: string;
  projectId?: string | null;
  environment: string;
  authMethod: string;
  plaintext: string;
  existingFamilyId?: string | null;
  actorUserId?: string | null;
}): Promise<{ familyId: string; legacyEncrypted: EncryptedSecret }> => {
  const created = await createCredentialVersion({
    organizationId: input.organizationId,
    familyId: input.existingFamilyId ?? undefined,
    connectionId: input.connectionId,
    projectId: input.projectId ?? null,
    purpose: "CONNECTION_AUTH",
    credentialType: connectionCredentialType(input.authMethod),
    environment: input.environment,
    plaintext: input.plaintext,
    createdBy: input.actorUserId ?? null,
    gracePeriodMs: input.existingFamilyId ? DEFAULT_GRACE_PERIOD_MS : null,
    actorUserId: input.actorUserId ?? null
  });
  return {
    familyId: created.familyId,
    legacyEncrypted: encryptSecret(input.plaintext)
  };
};

export const rotateConnectionManagedCredential = async (input: {
  organizationId: string;
  familyId: string;
  plaintext: string;
  actorUserId?: string | null;
}): Promise<{ legacyEncrypted: EncryptedSecret }> => {
  await rotateCredential({
    organizationId: input.organizationId,
    familyId: input.familyId,
    plaintext: input.plaintext,
    gracePeriodMs: DEFAULT_GRACE_PERIOD_MS,
    actorUserId: input.actorUserId ?? null
  });
  return { legacyEncrypted: encryptSecret(input.plaintext) };
};

export const resolveConnectionSecrets = async (
  connection: ConnectionSecretSource & {
    id?: string;
    projectId?: string | null;
    environment?: string | null;
  }
): Promise<ResolvedCredentialSecret[]> => {
  if (connection.credentialFamilyId) {
    const managed = await resolveActiveSecrets({
      organizationId: connection.organizationId,
      familyId: connection.credentialFamilyId,
      connectionId: connection.id ?? null,
      projectId: connection.projectId ?? null,
      environment: connection.environment ?? null
    });
    if (managed.length > 0) return managed;
  }

  const legacy = decryptLegacyManagedSecret(connection);
  if (legacy) {
    return [
      {
        id: "legacy",
        version: 0,
        status: "ACTIVE",
        plaintext: legacy,
        fingerprint: null
      }
    ];
  }

  const fromRef = resolveConnectionSecretReference(connection.secretRef);
  if (fromRef) {
    return [
      {
        id: "secret-ref",
        version: 0,
        status: "ACTIVE",
        plaintext: fromRef,
        fingerprint: null
      }
    ];
  }

  return [];
};

export const resolveConnectionSecret = async (
  connection: ConnectionSecretSource & {
    id?: string;
    projectId?: string | null;
    environment?: string | null;
  }
): Promise<string | null> => {
  const resolved = await resolveConnectionSecrets(connection);
  return resolved[0]?.plaintext ?? null;
};

export const resolveIngestSecrets = async (
  connection: ConnectionSecretSource & {
    id?: string;
    projectId?: string | null;
    environment?: string | null;
  }
): Promise<string[]> =>
  (await resolveConnectionSecrets(connection)).map((entry) => entry.plaintext);

export const recordConnectionCredentialProbe = async (
  connection: ConnectionSecretSource & { id?: string; projectId?: string | null; environment?: string | null },
  result: { succeeded: boolean }
): Promise<void> => {
  if (!connection.credentialFamilyId) return;
  const resolved = await resolveActiveSecrets({
    organizationId: connection.organizationId,
    familyId: connection.credentialFamilyId,
    connectionId: connection.id ?? null,
    projectId: connection.projectId ?? null,
    environment: connection.environment ?? null
  });
  const active = resolved.find((entry) => entry.status === "ACTIVE") ?? resolved[0];
  if (!active || active.id.startsWith("legacy") || active.id.startsWith("secret-ref")) return;
  if (result.succeeded) {
    await markCredentialSuccess(active.id, connection.organizationId);
  } else {
    await markCredentialFailure(active.id, connection.organizationId);
  }
};

export const sanitizeConnectionError = (
  error: string | undefined,
  secrets: Array<string | null | undefined> = []
): string | undefined => {
  if (!error) return error;
  let sanitized = error.replace(/Authorization:\s*[^\s,]+/gi, "Authorization: [redacted]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  return sanitized;
};
