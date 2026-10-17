/**
 * Issue a per-computer OpsWatch credential for NiiNai.
 * The project signing secret is not copied. The new secret is written only
 * to the credential file outside the NiiNai application.
 */
import { randomBytes, randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { createCredentialVersion } from "../apps/api/src/services/credentials/managed-credential.service";
import { NIINAI_DEVICE_CREDENTIAL_PREFIX } from "../apps/api/src/services/device-heartbeat";
import { NIINAI_PROJECT_SLUG } from "../apps/api/src/services/niinai-cloud-check";
import { mapProjectEnvironmentToKeyEnvironment } from "../apps/api/src/middleware/auth";
import { sha256 } from "../apps/api/src/utils/crypto";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient();
const SECRETS_DIR = "C:/Users/edwar/Documents/OKANGGROUP-backups/secrets";

const readArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function main() {
  const requestedId = readArg("device-id") || randomUUID();
  if (!isUuid(requestedId)) throw new Error("device-id must be a UUID");
  const deviceId = requestedId.toLowerCase();
  const endpoint = (readArg("endpoint") || `http://127.0.0.1:${process.env.PORT || "4000"}/api`).replace(/\/$/, "");
  const filePath = path.join(SECRETS_DIR, `niinai-computer-${deviceId.slice(0, 8)}.json`);

  const project = await prisma.project.findFirst({
    where: { slug: NIINAI_PROJECT_SLUG },
    select: { id: true, organizationId: true, environment: true, status: true, automationMode: true, remediationEmergencyDisabled: true }
  });
  if (!project?.organizationId) throw new Error("NiiNai Guest House is not registered in this OpsWatch database");
  if (project.automationMode !== "MONITOR_ONLY" || project.remediationEmergencyDisabled !== true) {
    throw new Error("NiiNai Guest House is not observe-only. Enrolment stopped.");
  }

  const name = `${NIINAI_DEVICE_CREDENTIAL_PREFIX}${deviceId}`;
  const existing = await prisma.orgApiKey.findFirst({
    where: { projectId: project.id, name, revokedAt: null }
  });
  if (existing) {
    if (!fs.existsSync(filePath)) {
      throw new Error("This computer is already enrolled, and its credential file is missing. Enrolment was not repeated.");
    }
    console.log(JSON.stringify({
      action: "already-enrolled",
      deviceId,
      keyId: existing.keyId,
      credentialFile: filePath
    }));
    return;
  }

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const signingSecret = randomBytes(32).toString("hex");
  await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId: project.organizationId,
      projectId: project.id,
      name,
      keyId,
      secretHash: sha256(secret),
      scopes: ["heartbeats:write"],
      environment: "live"
    }
  });
  await createCredentialVersion({
    organizationId: project.organizationId,
    projectId: project.id,
    purpose: "DEVICE_HEARTBEAT",
    credentialType: "HMAC_SECRET",
    environment: mapProjectEnvironmentToKeyEnvironment(project.environment),
    plaintext: signingSecret
  });

  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    endpoint,
    projectSlug: NIINAI_PROJECT_SLUG,
    environment: project.environment,
    apiKey: `${keyId}.${secret}`,
    signingSecret,
    deviceId
  }, null, 2), { flag: "wx" });

  console.log(JSON.stringify({
      action: "enrolled",
      deviceId,
      keyId,
      projectStatus: project.status,
    scopes: ["heartbeats:write"],
    credentialFile: filePath
  }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "enrolment failed";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
