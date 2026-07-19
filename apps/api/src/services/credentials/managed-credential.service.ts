import { randomUUID } from "crypto";
import type { ManagedCredential, Project } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  decryptSecretVersioned,
  encryptSecretVersioned,
  fingerprintSecret,
  maskedSuffix,
  type VersionedEncryptedSecret
} from "../../lib/secret-crypto";
import { recordCredentialAudit } from "./credential-audit.service";

export type CredentialPurpose =
  | "PROJECT_SIGNING"
  | "CONNECTION_AUTH"
  | "REMEDIATOR"
  | "WEBHOOK"
  | "OTEL"
  | "PROVIDER";

export type CredentialType =
  | "HMAC_SECRET"
  | "BEARER_TOKEN"
  | "API_KEY"
  | "STATIC_KEY"
  | "PROVIDER_SECRET";

export type CredentialStatus = "ACTIVE" | "GRACE" | "INACTIVE" | "REVOKED" | "EXPIRED";

export type ManagedCredentialRow = ManagedCredential;

export type CredentialMetadataDto = {
  configured: boolean;
  purpose: string;
  type: string;
  environment: string;
  version: number;
  status: string;
  createdAt: Date;
  activatedAt: Date;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
  lastUsedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  maskedSuffix: string | null;
  keyVersion: string;
};

export type CreateCredentialVersionInput = {
  organizationId: string;
  familyId?: string | null;
  projectId?: string | null;
  connectionId?: string | null;
  integrationId?: string | null;
  purpose: CredentialPurpose;
  credentialType: CredentialType;
  environment: string;
  plaintext: string;
  expiresAt?: Date | null;
  createdBy?: string | null;
  gracePeriodMs?: number | null;
  actorUserId?: string | null;
};

export type RotateCredentialInput = {
  organizationId: string;
  familyId: string;
  plaintext: string;
  createdBy?: string | null;
  gracePeriodMs?: number | null;
  actorUserId?: string | null;
};

export type RevokeCredentialInput = {
  organizationId: string;
  familyId?: string;
  credentialId?: string;
  reason: string;
  actorUserId?: string | null;
};

export type ResolveActiveSecretsInput = {
  organizationId: string;
  familyId: string;
  projectId?: string | null;
  connectionId?: string | null;
  environment?: string | null;
  allowCrossEnvironment?: boolean;
  now?: Date;
};

export type ResolvedCredentialSecret = {
  id: string;
  version: number;
  status: CredentialStatus;
  plaintext: string;
  fingerprint: string | null;
};

const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const MAX_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeGracePeriodMs = (value?: number | null): number => {
  const requested = value ?? DEFAULT_GRACE_PERIOD_MS;
  return Math.min(Math.max(requested, 0), MAX_GRACE_PERIOD_MS);
};

const buildAad = (input: {
  organizationId: string;
  purpose: string;
  familyId: string;
  version: number;
}): string => `${input.organizationId}:${input.purpose}:${input.familyId}:${input.version}`;

const assertOwnership = (
  row: Pick<ManagedCredential, "organizationId" | "projectId" | "connectionId">,
  input: Pick<ResolveActiveSecretsInput, "organizationId" | "projectId" | "connectionId">
): void => {
  if (row.organizationId !== input.organizationId) {
    throw new Error("Managed credential organization mismatch");
  }
  if (input.projectId && row.projectId && row.projectId !== input.projectId) {
    throw new Error("Managed credential project mismatch");
  }
  if (input.connectionId && row.connectionId && row.connectionId !== input.connectionId) {
    throw new Error("Managed credential connection mismatch");
  }
};

const decryptRow = (row: ManagedCredentialRow): string =>
  decryptSecretVersioned(
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion
    } satisfies VersionedEncryptedSecret,
    buildAad({
      organizationId: row.organizationId,
      purpose: row.purpose,
      familyId: row.familyId,
      version: row.version
    })
  );

const isResolvableStatus = (
  row: ManagedCredentialRow,
  now: Date
): row is ManagedCredentialRow & { status: "ACTIVE" | "GRACE" } => {
  if (row.status === "ACTIVE") {
    return !row.expiresAt || row.expiresAt > now;
  }
  if (row.status === "GRACE") {
    return Boolean(row.graceExpiresAt && row.graceExpiresAt > now);
  }
  return false;
};

export const toCredentialMetadataDto = (
  row: ManagedCredentialRow | null | undefined
): CredentialMetadataDto | null => {
  if (!row) return null;
  return {
    configured: true,
    purpose: row.purpose,
    type: row.credentialType,
    environment: row.environment,
    version: row.version,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
    graceExpiresAt: row.graceExpiresAt,
    lastUsedAt: row.lastUsedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    maskedSuffix: row.maskedSuffix,
    keyVersion: row.keyVersion
  };
};

export const createCredentialVersion = async (
  input: CreateCredentialVersionInput
): Promise<ManagedCredentialRow> => {
  const familyId = input.familyId?.trim() || randomUUID();
  const now = new Date();
  const gracePeriodMs = input.gracePeriodMs ?? null;

  const latest = await prisma.managedCredential.findFirst({
    where: { familyId, organizationId: input.organizationId },
    orderBy: { version: "desc" }
  });

  if (latest) {
    assertOwnership(latest, input);
  }

  const version = (latest?.version ?? 0) + 1;
  const encrypted = encryptSecretVersioned(
    input.plaintext,
    buildAad({
      organizationId: input.organizationId,
      purpose: input.purpose,
      familyId,
      version
    })
  );

  const created = await prisma.$transaction(async (tx) => {
    const activeRows = await tx.managedCredential.findMany({
      where: { familyId, organizationId: input.organizationId, status: "ACTIVE" }
    });

    for (const active of activeRows) {
      if (gracePeriodMs && gracePeriodMs > 0) {
        await tx.managedCredential.update({
          where: { id: active.id },
          data: {
            status: "GRACE",
            graceExpiresAt: new Date(now.getTime() + normalizeGracePeriodMs(gracePeriodMs)),
            updatedAt: now
          }
        });
      } else {
        await tx.managedCredential.update({
          where: { id: active.id },
          data: { status: "INACTIVE", updatedAt: now }
        });
      }
    }

    return tx.managedCredential.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        connectionId: input.connectionId ?? null,
        integrationId: input.integrationId ?? null,
        familyId,
        purpose: input.purpose,
        credentialType: input.credentialType,
        environment: input.environment,
        version,
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        maskedSuffix: maskedSuffix(input.plaintext),
        fingerprint: fingerprintSecret(input.plaintext),
        status: "ACTIVE",
        activatedAt: now,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy ?? null,
        rotatedFromId: latest?.id ?? null,
        updatedAt: now
      }
    });
  });

  await recordCredentialAudit({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    action: latest ? "CREDENTIAL_REPLACED" : "CREDENTIAL_CREATED",
    entityType: "MANAGED_CREDENTIAL",
    entityId: created.id,
    metadata: {
      familyId,
      purpose: input.purpose,
      version,
      projectId: input.projectId ?? null,
      connectionId: input.connectionId ?? null,
      integrationId: input.integrationId ?? null
    }
  });

  return created;
};

export const rotateCredential = async (input: RotateCredentialInput): Promise<ManagedCredentialRow> => {
  const active = await prisma.managedCredential.findFirst({
    where: {
      familyId: input.familyId,
      organizationId: input.organizationId,
      status: "ACTIVE"
    },
    orderBy: { version: "desc" }
  });

  if (!active) {
    throw new Error("No active managed credential found for rotation");
  }

  const gracePeriodMs = normalizeGracePeriodMs(input.gracePeriodMs);
  const now = new Date();

  const created = await createCredentialVersion({
    organizationId: input.organizationId,
    familyId: input.familyId,
    projectId: active.projectId,
    connectionId: active.connectionId,
    integrationId: active.integrationId,
    purpose: active.purpose as CredentialPurpose,
    credentialType: active.credentialType as CredentialType,
    environment: active.environment,
    plaintext: input.plaintext,
    expiresAt: active.expiresAt,
    createdBy: input.createdBy ?? null,
    gracePeriodMs,
    actorUserId: input.actorUserId
  });

  await prisma.managedCredential.updateMany({
    where: {
      familyId: input.familyId,
      organizationId: input.organizationId,
      status: "ACTIVE",
      id: { not: created.id }
    },
    data: { status: "INACTIVE", updatedAt: now }
  });

  await recordCredentialAudit({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    action: "CREDENTIAL_ROTATED",
    entityType: "MANAGED_CREDENTIAL",
    entityId: created.id,
    metadata: {
      familyId: input.familyId,
      previousVersion: active.version,
      newVersion: created.version,
      gracePeriodMs
    }
  });

  return created;
};

export const revokeCredentialFamily = async (input: RevokeCredentialInput): Promise<number> => {
  if (!input.familyId) {
    throw new Error("familyId is required to revoke a credential family");
  }
  return revokeCredentialVersions({
    ...input,
    familyId: input.familyId
  });
};

export const revokeCredentialVersion = async (input: RevokeCredentialInput): Promise<number> => {
  if (!input.credentialId) {
    throw new Error("credentialId is required to revoke a credential version");
  }

  const row = await prisma.managedCredential.findUnique({ where: { id: input.credentialId } });
  if (!row || row.organizationId !== input.organizationId) {
    throw new Error("Managed credential not found");
  }

  const now = new Date();
  await prisma.managedCredential.update({
    where: { id: row.id },
    data: {
      status: "REVOKED",
      revokedAt: now,
      revokeReason: input.reason,
      updatedAt: now
    }
  });

  await recordCredentialAudit({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    action: "CREDENTIAL_REVOKED",
    entityType: "MANAGED_CREDENTIAL",
    entityId: row.id,
    metadata: { familyId: row.familyId, version: row.version, reason: input.reason }
  });

  return 1;
};

const revokeCredentialVersions = async (
  input: RevokeCredentialInput & { familyId: string }
): Promise<number> => {
  const now = new Date();
  const result = await prisma.managedCredential.updateMany({
    where: {
      organizationId: input.organizationId,
      familyId: input.familyId,
      status: { in: ["ACTIVE", "GRACE", "INACTIVE"] }
    },
    data: {
      status: "REVOKED",
      revokedAt: now,
      revokeReason: input.reason,
      updatedAt: now
    }
  });

  if (result.count > 0) {
    await recordCredentialAudit({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      action: "CREDENTIAL_REVOKED",
      entityType: "MANAGED_CREDENTIAL_FAMILY",
      entityId: input.familyId,
      metadata: { familyId: input.familyId, reason: input.reason, count: result.count }
    });
  }

  return result.count;
};

export const resolveActiveSecrets = async (
  input: ResolveActiveSecretsInput
): Promise<ResolvedCredentialSecret[]> => {
  const now = input.now ?? new Date();
  const rows = await prisma.managedCredential.findMany({
    where: {
      organizationId: input.organizationId,
      familyId: input.familyId,
      status: { in: ["ACTIVE", "GRACE"] }
    },
    orderBy: { version: "desc" }
  });

  const resolved: ResolvedCredentialSecret[] = [];
  for (const row of rows) {
    assertOwnership(row, input);
    if (!isResolvableStatus(row, now)) continue;
    if (
      input.environment &&
      row.environment !== input.environment &&
      !input.allowCrossEnvironment
    ) {
      continue;
    }
    resolved.push({
      id: row.id,
      version: row.version,
      status: row.status as CredentialStatus,
      plaintext: decryptRow(row),
      fingerprint: row.fingerprint
    });
  }

  return resolved;
};

export type ProjectSigningContext = Pick<
  Project,
  "id" | "organizationId" | "environment" | "signingSecret" | "signingCredentialFamilyId"
>;

export const resolveSigningSecretsForProject = async (
  project: ProjectSigningContext
): Promise<ResolvedCredentialSecret[]> => {
  if (!project.organizationId) {
    return project.signingSecret?.trim()
      ? [
          {
            id: `legacy:${project.id}`,
            version: 0,
            status: "ACTIVE",
            plaintext: project.signingSecret.trim(),
            fingerprint: fingerprintSecret(project.signingSecret.trim())
          }
        ]
      : [];
  }

  if (project.signingCredentialFamilyId) {
    const managed = await resolveActiveSecrets({
      organizationId: project.organizationId,
      familyId: project.signingCredentialFamilyId,
      projectId: project.id,
      environment: project.environment
    });
    if (managed.length > 0) {
      return managed;
    }
  }

  if (project.signingSecret?.trim()) {
    return [
      {
        id: `legacy:${project.id}`,
        version: 0,
        status: "ACTIVE",
        plaintext: project.signingSecret.trim(),
        fingerprint: fingerprintSecret(project.signingSecret.trim())
      }
    ];
  }

  return [];
};

export const markCredentialUsed = async (credentialId: string, organizationId: string): Promise<void> => {
  const now = new Date();
  const updated = await prisma.managedCredential.updateMany({
    where: { id: credentialId, organizationId },
    data: { lastUsedAt: now, updatedAt: now }
  });
  if (updated.count === 0) {
    throw new Error("Managed credential not found");
  }
};

export const markCredentialSuccess = async (
  credentialId: string,
  organizationId: string
): Promise<void> => {
  const now = new Date();
  const updated = await prisma.managedCredential.updateMany({
    where: { id: credentialId, organizationId },
    data: { lastUsedAt: now, lastSuccessAt: now, updatedAt: now }
  });
  if (updated.count === 0) {
    throw new Error("Managed credential not found");
  }
};

export const markCredentialFailure = async (
  credentialId: string,
  organizationId: string
): Promise<void> => {
  const now = new Date();
  const updated = await prisma.managedCredential.updateMany({
    where: { id: credentialId, organizationId },
    data: { lastUsedAt: now, lastFailureAt: now, updatedAt: now }
  });
  if (updated.count === 0) {
    throw new Error("Managed credential not found");
  }
};

export const expireDueCredentials = async (now = new Date()): Promise<number> => {
  const expired = await prisma.managedCredential.updateMany({
    where: {
      status: { in: ["ACTIVE", "GRACE"] },
      expiresAt: { lt: now }
    },
    data: { status: "EXPIRED", updatedAt: now }
  });

  const graceExpired = await prisma.managedCredential.updateMany({
    where: {
      status: "GRACE",
      graceExpiresAt: { lt: now }
    },
    data: { status: "INACTIVE", updatedAt: now }
  });

  return expired.count + graceExpired.count;
};
