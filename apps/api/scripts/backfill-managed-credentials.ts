/**
 * Idempotent backfill: legacy connection/project/integration secrets into ManagedCredential.
 *
 *   pnpm --filter @opswatch/api exec tsx scripts/backfill-managed-credentials.ts
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/secret-crypto";
import {
  createCredentialVersion,
  type CredentialPurpose,
  type CredentialType
} from "../src/services/credentials/managed-credential.service";
import {
  REMEDIATOR_SECRET_ENC_KEY,
  resolveRemediatorSecret
} from "../src/services/remediation/remediator-config";

const prisma = new PrismaClient();

const connectionCredentialType = (authMethod: string): CredentialType => {
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

const backfillConnections = async (): Promise<number> => {
  const rows = await prisma.connection.findMany({
    where: {
      credentialFamilyId: null,
      managedSecretCiphertext: { not: null },
      managedSecretIv: { not: null },
      managedSecretAuthTag: { not: null }
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      environment: true,
      authMethod: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true
    }
  });

  let migrated = 0;
  for (const row of rows) {
    const plaintext = decryptSecret({
      ciphertext: row.managedSecretCiphertext!,
      iv: row.managedSecretIv!,
      authTag: row.managedSecretAuthTag!
    });

    const created = await createCredentialVersion({
      organizationId: row.organizationId,
      connectionId: row.id,
      projectId: row.projectId,
      purpose: "CONNECTION_AUTH",
      credentialType: connectionCredentialType(row.authMethod),
      environment: row.environment,
      plaintext
    });

    await prisma.connection.update({
      where: { id: row.id },
      data: { credentialFamilyId: created.familyId, updatedAt: new Date() }
    });
    migrated += 1;
  }

  return migrated;
};

const backfillProjectSigning = async (): Promise<number> => {
  const rows = await prisma.project.findMany({
    where: {
      signingCredentialFamilyId: null,
      signingSecret: { not: "" },
      organizationId: { not: null }
    },
    select: {
      id: true,
      organizationId: true,
      environment: true,
      signingSecret: true,
      createdAt: true
    }
  });

  let migrated = 0;
  for (const row of rows) {
    if (!row.organizationId) continue;

    const created = await createCredentialVersion({
      organizationId: row.organizationId,
      projectId: row.id,
      purpose: "PROJECT_SIGNING",
      credentialType: "HMAC_SECRET",
      environment: row.environment,
      plaintext: row.signingSecret
    });

    await prisma.project.update({
      where: { id: row.id },
      data: {
        signingCredentialFamilyId: created.familyId,
        signingSecretRotatedAt: row.createdAt,
        updatedAt: new Date()
      }
    });
    migrated += 1;
  }

  return migrated;
};

const backfillRemediatorIntegrations = async (): Promise<number> => {
  const rows = await prisma.projectIntegration.findMany({
    where: { credentialFamilyId: null },
    select: {
      id: true,
      projectId: true,
      type: true,
      configJson: true,
      secretRef: true,
      Project: { select: { organizationId: true, environment: true } }
    }
  });

  let migrated = 0;
  for (const row of rows) {
    const organizationId = row.Project.organizationId;
    if (!organizationId) continue;

    const config =
      row.configJson && typeof row.configJson === "object" && !Array.isArray(row.configJson)
        ? (row.configJson as Record<string, unknown>)
        : null;
    const hasEnc = Boolean(config?.[REMEDIATOR_SECRET_ENC_KEY]);
    const plaintext = resolveRemediatorSecret(config, row.secretRef);
    if (!plaintext || !hasEnc) continue;

    const created = await createCredentialVersion({
      organizationId,
      projectId: row.projectId,
      integrationId: row.id,
      purpose: "REMEDIATOR" satisfies CredentialPurpose,
      credentialType: "HMAC_SECRET",
      environment: row.Project.environment,
      plaintext
    });

    await prisma.projectIntegration.update({
      where: { id: row.id },
      data: { credentialFamilyId: created.familyId, updatedAt: new Date() }
    });
    migrated += 1;
  }

  return migrated;
};

const main = async (): Promise<void> => {
  const [connections, signing, remediator] = await Promise.all([
    backfillConnections(),
    backfillProjectSigning(),
    backfillRemediatorIntegrations()
  ]);

  console.info(
    `[backfill-managed-credentials] connections=${connections} project_signing=${signing} remediator=${remediator}`
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
