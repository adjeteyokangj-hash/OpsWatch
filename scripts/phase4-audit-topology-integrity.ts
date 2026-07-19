import { prisma } from "../apps/api/src/lib/prisma";
import { auditCanonicalTopologyIntegrity } from "../apps/api/src/services/topology-integrity-audit.service";

const main = async () => {
  const report = await auditCanonicalTopologyIntegrity();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passes) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
