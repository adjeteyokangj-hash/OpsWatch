import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN (
         'LogRecord','LogOccurrenceGroup','TraceRecord','SpanRecord',
         'ApmServiceWindow','ApmEndpointWindow','ApmDependencyWindow',
         'LogEvidenceLink','SpanEvidenceLink','ApmEvidenceLink'
       )
     ORDER BY 1`
  );
  console.log("phase6_tables", tables.map((t) => t.table_name).join(","));
  console.log("counts", {
    LogRecord: await prisma.logRecord.count(),
    LogOccurrenceGroup: await prisma.logOccurrenceGroup.count(),
    TraceRecord: await prisma.traceRecord.count(),
    SpanRecord: await prisma.spanRecord.count(),
    ApmServiceWindow: await prisma.apmServiceWindow.count(),
    NormalizedOperationalSignal: await prisma.normalizedOperationalSignal.count(),
    Alert: await prisma.alert.count(),
    Incident: await prisma.incident.count()
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
