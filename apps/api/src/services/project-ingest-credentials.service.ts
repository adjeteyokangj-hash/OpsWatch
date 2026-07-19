import { randomBytes, randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { sha256 } from "../utils/crypto";
import { createCredentialVersion } from "./credentials/managed-credential.service";
import { mapProjectEnvironmentToKeyEnvironment } from "../middleware/auth";

export const DEFAULT_INGEST_SCOPES = ["events:write", "heartbeats:write"] as const;

export type ProvisionedIngestCredentials = {
  apiKey: string;
  keyId: string;
  signingSecret: string;
  signingSecretConfigured?: boolean;
  lastRotatedAt?: string | null;
  keyVersion?: number | null;
  projectSlug: string;
  scopes: string[];
  reused: boolean;
};

const asScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const hasIngestScopes = (scopes: string[]): boolean =>
  DEFAULT_INGEST_SCOPES.every((scope) => scopes.includes(scope));

export const hasActiveProjectIngestKey = async (
  organizationId: string,
  projectId: string
): Promise<boolean> => {
  const now = new Date();
  const rows = await prisma.orgApiKey.findMany({
    where: {
      organizationId,
      projectId,
      revokedAt: null,
      AND: [
        { OR: [{ graceExpiresAt: null }, { graceExpiresAt: { gt: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
      ]
    },
    select: { scopes: true }
  });

  return rows.some((row) => hasIngestScopes(asScopes(row.scopes)));
};

export const provisionProjectSigningSecret = async (input: {
  organizationId: string;
  projectId: string;
  signingSecret: string;
  environment: string;
  actorUserId?: string | null;
}): Promise<{ familyId: string; version: number; rotatedAt: Date }> => {
  const created = await createCredentialVersion({
    organizationId: input.organizationId,
    projectId: input.projectId,
    purpose: "PROJECT_SIGNING",
    credentialType: "HMAC_SECRET",
    environment: mapProjectEnvironmentToKeyEnvironment(input.environment),
    plaintext: input.signingSecret,
    actorUserId: input.actorUserId ?? null
  });

  const rotatedAt = created.activatedAt;
  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      signingCredentialFamilyId: created.familyId,
      signingSecretRotatedAt: rotatedAt
    }
  });

  return {
    familyId: created.familyId,
    version: created.version,
    rotatedAt
  };
};

const loadSigningMetadata = async (
  projectId: string
): Promise<{
  signingSecretConfigured: boolean;
  lastRotatedAt: string | null;
  keyVersion: number | null;
}> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      signingSecret: true,
      signingSecretRotatedAt: true,
      signingCredentialFamilyId: true,
      organizationId: true
    }
  });

  if (!project) {
    return { signingSecretConfigured: false, lastRotatedAt: null, keyVersion: null };
  }

  let keyVersion: number | null = null;
  if (project.signingCredentialFamilyId && project.organizationId) {
    const latest = await prisma.managedCredential.findFirst({
      where: {
        organizationId: project.organizationId,
        familyId: project.signingCredentialFamilyId,
        status: "ACTIVE"
      },
      orderBy: { version: "desc" },
      select: { version: true }
    });
    keyVersion = latest?.version ?? null;
  }

  return {
    signingSecretConfigured: Boolean(project.signingSecret?.trim() || project.signingCredentialFamilyId),
    lastRotatedAt: project.signingSecretRotatedAt?.toISOString() ?? null,
    keyVersion
  };
};

export const provisionProjectIngestCredentials = async (input: {
  organizationId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  signingSecret: string;
  environment?: "live" | "test";
}): Promise<ProvisionedIngestCredentials> => {
  const existing = await hasActiveProjectIngestKey(input.organizationId, input.projectId);
  if (existing) {
    const row = await prisma.orgApiKey.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      orderBy: { createdAt: "desc" }
    });
    const signingMetadata = await loadSigningMetadata(input.projectId);

    return {
      apiKey: "",
      keyId: row?.keyId ?? "",
      signingSecret: "",
      signingSecretConfigured: signingMetadata.signingSecretConfigured,
      lastRotatedAt: signingMetadata.lastRotatedAt,
      keyVersion: signingMetadata.keyVersion,
      projectSlug: input.projectSlug,
      scopes: [...DEFAULT_INGEST_SCOPES],
      reused: true
    };
  }

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const environment = input.environment ?? "live";
  const name = `${input.projectName} live ingest`;

  await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      name,
      keyId,
      secretHash: sha256(secret),
      scopes: [...DEFAULT_INGEST_SCOPES],
      environment
    }
  });

  return {
    apiKey: `${keyId}.${secret}`,
    keyId,
    signingSecret: input.signingSecret,
    signingSecretConfigured: true,
    lastRotatedAt: null,
    keyVersion: null,
    projectSlug: input.projectSlug,
    scopes: [...DEFAULT_INGEST_SCOPES],
    reused: false
  };
};

export const projectHasProductInfo = (input: {
  frontendUrl?: string | null;
  backendUrl?: string | null;
  name?: string | null;
  clientName?: string | null;
}): boolean => {
  const frontend = input.frontendUrl?.trim();
  const backend = input.backendUrl?.trim();
  const name = input.name?.trim();
  const clientName = input.clientName?.trim();
  return Boolean(name && clientName && (frontend || backend));
};
