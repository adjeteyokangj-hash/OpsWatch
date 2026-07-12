/**
 * Idempotent deployment script: backfill ProjectBilling for legacy projects.
 * Run once after migrate deploy — not during normal API reads.
 *
 *   pnpm --filter @opswatch/api exec tsx scripts/backfill-project-billing.ts
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  const missing = await prisma.project.findMany({
    where: { ProjectBilling: null },
    select: { id: true, createdAt: true }
  });

  if (missing.length === 0) {
    console.info("[backfill-project-billing] All projects already have billing rows.");
    return;
  }

  let created = 0;
  for (const project of missing) {
    await prisma.projectBilling.create({
      data: {
        id: `pbb-${project.id}`,
        projectId: project.id,
        plan: "FREE",
        monthlyPrice: 0,
        currency: "GBP",
        billingStatus: "ACTIVE",
        billingStartDate: project.createdAt,
        dataRetentionDays: 30,
        checkLimit: 50,
        userLimit: 5,
        automationRunLimit: 100,
        updatedAt: new Date()
      }
    });
    created += 1;
  }

  console.info(`[backfill-project-billing] Created ${created} billing row(s).`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
