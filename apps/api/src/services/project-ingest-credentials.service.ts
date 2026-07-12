import { randomBytes, randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { sha256 } from "../utils/crypto";

export const DEFAULT_INGEST_SCOPES = ["events:write", "heartbeats:write"] as const;

export type ProvisionedIngestCredentials = {
  apiKey: string;
  keyId: string;
  signingSecret: string;
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
  const rows = await prisma.orgApiKey.findMany({
    where: {
      organizationId,
      projectId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { scopes: true }
  });

  return rows.some((row) => hasIngestScopes(asScopes(row.scopes)));
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

    return {
      apiKey: "",
      keyId: row?.keyId ?? "",
      signingSecret: input.signingSecret,
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
