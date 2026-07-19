/**
 * Mark OTEL entities for a project as past freshUntil and run freshness.
 * Test-labelled local verification only.
 */
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

async function main() {
  const projectId = process.argv.find((_, i, a) => a[i - 1] === "--projectId");
  if (!projectId) throw new Error("Usage: --projectId <id>");

  const { prisma } = await import("../apps/api/src/lib/prisma");
  const { processOtelFreshness } = await import(
    "../apps/api/src/services/otel/otel-freshness.service"
  );

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true, name: true }
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!/TEST ONLY|PW OTEL|pw-otel/i.test(project.name)) {
    throw new Error("Refusing to mutate non-test project");
  }

  await prisma.operationalEntity.updateMany({
    where: { organizationId: project.organizationId, projectId, discoverySource: "OTEL_BRIDGE" },
    data: { freshUntil: new Date(Date.now() - 60_000), discoveryState: "ACTIVE" }
  });
  const result = await processOtelFreshness();
  const stale = await prisma.operationalEntity.count({
    where: {
      organizationId: project.organizationId,
      projectId,
      discoveryState: "STALE",
      health: "UNKNOWN"
    }
  });
  console.log(JSON.stringify({ result, staleUnknown: stale }));
  await prisma.$disconnect();
  if (stale < 1) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
