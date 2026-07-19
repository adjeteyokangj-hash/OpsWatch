import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const projectId = process.argv[2] || "app-noble-express";

const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const [entities, rels, mappings, services, deps, identities] = await Promise.all([
    prisma.operationalEntity.count({ where: { projectId } }),
    prisma.operationalRelationship.count({ where: { projectId } }),
    prisma.legacyServiceEntityMapping.count({ where: { projectId } }),
    prisma.service.count({ where: { projectId } }),
    prisma.serviceDependency.count({ where: { projectId } }),
    prisma.operationalEntityIdentity.count({ where: { projectId } })
  ]);
  console.log(
    JSON.stringify(
      { projectId, entities, rels, mappings, services, deps, identities },
      null,
      2
    )
  );
  await prisma.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
