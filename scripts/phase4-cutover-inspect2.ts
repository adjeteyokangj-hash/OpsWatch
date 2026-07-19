import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), "apps/api/.env") });
const projectId = process.env.CUTOVER_PROJECT_ID || "app-noble-express";
const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const incidents = await prisma.incident.findMany({
    where: { projectId, status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } },
    select: {
      id: true,
      title: true,
      IncidentAlert: {
        select: {
          Alert: {
            select: { id: true, title: true, status: true, serviceId: true, operationalEntityId: true }
          }
        }
      }
    }
  });
  const legacyResolved: unknown[] = [];
  for (const inc of incidents) {
    for (const ref of inc.IncidentAlert) {
      if (!ref.Alert.operationalEntityId && ref.Alert.serviceId) {
        legacyResolved.push({ incident: inc.title, ...ref.Alert });
      }
    }
  }
  console.log(JSON.stringify({ legacyResolvedIncidentAlerts: legacyResolved }, null, 2));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exitCode = 1; });
