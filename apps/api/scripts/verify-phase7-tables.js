const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const tables = await p.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('RemediationApproval','RemediationExecutionRun','RemediationCircuitBreaker') ORDER BY 1"
  );
  console.log(JSON.stringify(tables, null, 2));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
