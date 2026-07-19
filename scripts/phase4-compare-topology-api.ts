import "dotenv/config";
import { prisma } from "../apps/api/src/lib/prisma";
import {
  clearTopologyLoaderCache,
  loadProjectTopology
} from "../apps/api/src/services/topology-loader.service";

const projectId = process.argv.find((arg) => arg.startsWith("--project="))
  ?.split("=")[1] ?? "app-noble-express";

const signature = (edge: {
  sourceId: string;
  targetId: string;
  type: string;
}): string => `${edge.sourceId}|${edge.targetId}|${edge.type}`;

const main = async () => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true }
  });
  if (!project?.organizationId) throw new Error("Organized project not found");

  process.env.OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED = "false";
  clearTopologyLoaderCache();
  const legacy = await loadProjectTopology(project.organizationId, projectId);
  process.env.OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED = "true";
  clearTopologyLoaderCache();
  const canonical = await loadProjectTopology(project.organizationId, projectId);
  if (!legacy || !canonical) throw new Error("Topology response missing");

  const mappings = await prisma.legacyServiceEntityMapping.findMany({
    where: {
      organizationId: project.organizationId,
      projectId,
      status: "ACTIVE"
    },
    select: { entityId: true, legacyServiceId: true }
  });
  const legacyIdByEntity = new Map(
    mappings.map((mapping) => [mapping.entityId, mapping.legacyServiceId])
  );
  const canonicalLegacySignatures = new Set(
    canonical.edges.flatMap((edge) => {
      const sourceId = legacyIdByEntity.get(edge.sourceId);
      const targetId = legacyIdByEntity.get(edge.targetId);
      return sourceId && targetId
        ? [signature({ sourceId, targetId, type: edge.type })]
        : [];
    })
  );
  const missingRelationships = legacy.edges
    .map(signature)
    .filter((edge) => !canonicalLegacySignatures.has(edge));
  const output = {
    projectId,
    legacy: { nodes: legacy.nodes.length, edges: legacy.edges.length },
    canonical: {
      nodes: canonical.nodes.length,
      edges: canonical.edges.length
    },
    missingRelationships,
    passes: missingRelationships.length === 0
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.passes) process.exitCode = 2;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
