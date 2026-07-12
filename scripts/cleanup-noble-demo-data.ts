import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const demoSourcePatterns = [
  "demo-real-app",
  "integration test",
  "integration-test",
  "local-smoke",
  "verification ",
  "sparkle-smoke",
  "noble-express-cascade-validation",
  "dashboard-mvp-smoke"
];

const demoTitlePatterns = [
  "verification",
  "integration test",
  "local-smoke",
  "cascade-validation",
  "sparkle"
];

async function main(): Promise<void> {
  const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
  const projectIds = projects.map((row) => row.id);

  const events = await prisma.event.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, source: true, message: true }
  });
  const demoEventIds = events
    .filter((row) => {
      const haystack = `${row.source} ${row.message}`.toLowerCase();
      return demoSourcePatterns.some((pattern) => haystack.includes(pattern));
    })
    .map((row) => row.id);

  const alerts = await prisma.alert.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, title: true, message: true }
  });
  const demoAlertIds = alerts
    .filter((row) => {
      const haystack = `${row.title} ${row.message}`.toLowerCase();
      return demoTitlePatterns.some((pattern) => haystack.includes(pattern));
    })
    .map((row) => row.id);

  const heartbeats = await prisma.heartbeat.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, message: true }
  });
  const demoHeartbeatIds = heartbeats
    .filter((row) => (row.message || "").toLowerCase().includes("demo app heartbeat"))
    .map((row) => row.id);

  const [deletedEvents, deletedAlerts, deletedHeartbeats] = await prisma.$transaction([
    prisma.event.deleteMany({ where: { id: { in: demoEventIds } } }),
    prisma.alert.deleteMany({ where: { id: { in: demoAlertIds } } }),
    prisma.heartbeat.deleteMany({ where: { id: { in: demoHeartbeatIds } } })
  ]);

  console.log("DEMO_CLEANUP_COMPLETE");
  console.log("DELETED_EVENTS", deletedEvents.count);
  console.log("DELETED_ALERTS", deletedAlerts.count);
  console.log("DELETED_HEARTBEATS", deletedHeartbeats.count);
}

main()
  .catch((error) => {
    console.error("DEMO_CLEANUP_FAILED", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
