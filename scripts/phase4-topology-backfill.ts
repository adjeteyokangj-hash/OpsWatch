import "dotenv/config";
import { prisma } from "../apps/api/src/lib/prisma";
import {
  backfillCanonicalTopology,
  compareLegacyAndCanonicalTopology
} from "../apps/api/src/services/topology-unification.service";

const valueFor = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const main = async () => {
  const projectId = valueFor("project");
  const apply = process.argv.includes("--apply");
  const before = await compareLegacyAndCanonicalTopology(projectId);
  let backfill = null;
  if (apply) {
    backfill = await backfillCanonicalTopology({ projectId });
  }
  const after = await compareLegacyAndCanonicalTopology(projectId);
  const output = { mode: apply ? "apply" : "compare-only", before, backfill, after };
  console.log(JSON.stringify(output, null, 2));

  if (
    after.ambiguousMappings.length > 0 ||
    after.duplicates.length > 0 ||
    (apply &&
      (after.missingEntities.length > 0 ||
        after.missingRelationships.length > 0))
  ) {
    process.exitCode = 2;
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
