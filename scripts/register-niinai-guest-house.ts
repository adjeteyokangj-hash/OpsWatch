/**
 * Register NiiNai Guest House in the OpsWatch registry.
 * Observe-only. Does not read or write Isaac's Supabase database.
 * Additive: creates this project, its cloud check, and a heartbeat-only ingest key.
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { generateApiKey, generateSigningSecret, sha256 } from "../apps/api/src/utils/crypto";
import { provisionProjectSigningSecret } from "../apps/api/src/services/project-ingest-credentials.service";
import {
  NIINAI_CLOUD_SERVICE_NAME,
  NIINAI_PROJECT_NAME,
  NIINAI_PROJECT_SLUG,
  NIINAI_SUPABASE_HEALTH_URL,
  NIINAI_SUPABASE_ORIGIN,
  niinaiReachabilityConfig
} from "../apps/api/src/services/niinai-cloud-check";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient();
const SECRETS_PATH = path.resolve(
  "C:/Users/edwar/Documents/OKANGGROUP-backups/secrets/niinai-guest-house-opswatch.local.json"
);

async function resolveOkangGroupOrg() {
  const org = await prisma.organization.findFirst({
    where: {
      OR: [
        { slug: "okanggroup" },
        { name: { equals: "OkangGroup", mode: "insensitive" } },
        { name: { equals: "OKANGGROUP", mode: "insensitive" } }
      ]
    },
    orderBy: { createdAt: "asc" }
  });
  if (!org) {
    throw new Error(
      "OkangGroup organisation was not found. NiiNai was not attached to any other organisation."
    );
  }
  return org;
}

async function ensureCloudCheck(projectId: string) {
  const now = new Date();
  const configJson = niinaiReachabilityConfig();
  let service = await prisma.service.findFirst({
    where: { projectId, name: NIINAI_CLOUD_SERVICE_NAME }
  });
  if (!service) {
    service = await prisma.service.create({
      data: {
        id: randomUUID(),
        projectId,
        name: NIINAI_CLOUD_SERVICE_NAME,
        type: "API",
        status: "UNKNOWN",
        criticality: "HIGH",
        baseUrl: NIINAI_SUPABASE_HEALTH_URL,
        isCritical: true,
        updatedAt: now
      }
    });
  } else {
    service = await prisma.service.update({
      where: { id: service.id },
      data: {
        baseUrl: NIINAI_SUPABASE_HEALTH_URL,
        criticality: "HIGH",
        isCritical: true,
        updatedAt: now
      }
    });
  }

  const existingCheck = await prisma.check.findFirst({
    where: { serviceId: service.id, name: "Supabase HTTPS reachability" }
  });
  if (!existingCheck) {
    await prisma.check.create({
      data: {
        id: randomUUID(),
        serviceId: service.id,
        name: "Supabase HTTPS reachability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 10_000,
        expectedStatusCode: null,
        failureThreshold: 3,
        recoveryThreshold: 2,
        configJson,
        isActive: true,
        updatedAt: now
      }
    });
  } else {
    await prisma.check.update({
      where: { id: existingCheck.id },
      data: {
        isActive: true,
        configJson,
        intervalSeconds: 60,
        timeoutMs: 10_000,
        expectedStatusCode: null,
        updatedAt: now
      }
    });
  }
}

async function ensureHeartbeatKey(organizationId: string, projectId: string, signingSecret: string) {
  const existing = await prisma.orgApiKey.findFirst({
    where: {
      organizationId,
      projectId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    return { keyId: existing.keyId, apiKey: "", created: false, signingSecret: "" };
  }

  const keyId = `ow_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const secret = generateSigningSecret();
  await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId,
      projectId,
      name: "NiiNai Guest House heartbeat ingest",
      keyId,
      secretHash: sha256(secret),
      scopes: ["heartbeats:write"],
      environment: "live"
    }
  });
  return { keyId, apiKey: `${keyId}.${secret}`, created: true, signingSecret };
}

async function main() {
  const org = await resolveOkangGroupOrg();
  const now = new Date();
  const existing = await prisma.project.findUnique({ where: { slug: NIINAI_PROJECT_SLUG } });

  if (existing && existing.organizationId && existing.organizationId !== org.id) {
    throw new Error("NiiNai Guest House already exists on a different organisation. Refusing to move it.");
  }

  const project =
    existing ??
    (await prisma.project.create({
      data: {
        id: randomUUID(),
        name: NIINAI_PROJECT_NAME,
        slug: NIINAI_PROJECT_SLUG,
        clientName: "OkangGroup",
        description:
          "Observe-only technical health for the NiiNai guest house desktop applications. No guest, payment, or Supabase credentials.",
        environment: "production",
        organizationId: org.id,
        monitoringEnabled: true,
        monitoringStartedAt: now,
        isActive: true,
        status: "UNKNOWN",
        healthReason: "Waiting for Supabase reachability and computer heartbeats",
        healthSource: "niinai-register",
        automationMode: "MONITOR_ONLY",
        remediationEmergencyDisabled: true,
        projectOwner: "OkangGroup",
        backendUrl: NIINAI_SUPABASE_ORIGIN,
        apiKey: generateApiKey(),
        signingSecret: generateSigningSecret(),
        updatedAt: now
      }
    }));

  if (existing) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        automationMode: "MONITOR_ONLY",
        remediationEmergencyDisabled: true,
        monitoringEnabled: true,
        backendUrl: NIINAI_SUPABASE_ORIGIN,
        updatedAt: now
      }
    });
  }

  await ensureCloudCheck(project.id);

  let ingest: { keyId: string; apiKey: string; created: boolean; signingSecret: string } | null = null;
  if (!existing) {
    try {
      await provisionProjectSigningSecret({
        organizationId: org.id,
        projectId: project.id,
        signingSecret: project.signingSecret,
        environment: "production",
        actorUserId: null
      });
    } catch (error) {
      console.error(
        "SIGNING_PROVISION_WARNING",
        error instanceof Error ? error.message : error
      );
    }
    ingest = await ensureHeartbeatKey(org.id, project.id, project.signingSecret);
  } else {
    ingest = await ensureHeartbeatKey(org.id, project.id, project.signingSecret);
  }

  if (ingest?.created) {
    fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
    fs.writeFileSync(
      SECRETS_PATH,
      JSON.stringify(
        {
          createdAt: now.toISOString(),
          note: "LOCAL ONLY. Heartbeat ingest for NiiNai. Do not commit. This key cannot read OpsWatch or Isaac's database.",
          opswatchApiBaseUrl: "https://opswatch.okanggroup.com/api",
          projectSlug: NIINAI_PROJECT_SLUG,
          scopes: ["heartbeats:write"],
          keyId: ingest.keyId,
          apiKey: ingest.apiKey,
          signingSecret: ingest.signingSecret
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }

  console.log(
    JSON.stringify(
      {
        action: existing ? "updated" : "created",
        project: {
          id: project.id,
          slug: NIINAI_PROJECT_SLUG,
          name: NIINAI_PROJECT_NAME,
          automationMode: "MONITOR_ONLY",
          remediationEmergencyDisabled: true
        },
        organization: { id: org.id, slug: org.slug, name: org.name },
        cloudCheck: NIINAI_SUPABASE_HEALTH_URL,
        ingestKeyId: ingest?.keyId ?? null,
        ingestKeyCreated: Boolean(ingest?.created),
        secretsWritten: Boolean(ingest?.created),
        secretsPath: ingest?.created ? SECRETS_PATH : null
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("NIINAI_REGISTER_FAILED", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
