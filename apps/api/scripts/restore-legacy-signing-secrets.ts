/**
 * Rollback helper: restore managed PROJECT_SIGNING secrets into Project.signingSecret.
 *
 *   pnpm --filter @opswatch/api exec tsx scripts/restore-legacy-signing-secrets.ts
 */
import { PrismaClient } from "@prisma/client";
import { resolveSigningSecretsForProject } from "../src/services/credentials/managed-credential.service";

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  const projects = await prisma.project.findMany({
    where: { signingCredentialFamilyId: { not: null } },
    select: {
      id: true,
      organizationId: true,
      environment: true,
      signingSecret: true,
      signingCredentialFamilyId: true
    }
  });

  let restored = 0;
  for (const project of projects) {
    const secrets = await resolveSigningSecretsForProject(project);
    const active = secrets.find((entry) => entry.status === "ACTIVE") ?? secrets[0];
    if (!active?.plaintext) continue;

    await prisma.project.update({
      where: { id: project.id },
      data: {
        signingSecret: active.plaintext,
        updatedAt: new Date()
      }
    });
    restored += 1;
  }

  console.info(`[restore-legacy-signing-secrets] restored=${restored} total=${projects.length}`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
