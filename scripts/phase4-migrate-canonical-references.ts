import "dotenv/config";
import { prisma } from "../apps/api/src/lib/prisma";
import { migrateCanonicalReferences } from "../apps/api/src/services/canonical-reference-migration.service";

const projectId = process.argv.find((arg) => arg.startsWith("--project="))
  ?.split("=")[1];

migrateCanonicalReferences({ projectId })
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.unresolved.length > 0) process.exitCode = 2;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
