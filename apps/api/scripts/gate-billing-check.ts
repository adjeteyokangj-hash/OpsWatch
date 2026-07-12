import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.projectBilling.groupBy({
    by: ["plan"],
    _count: true,
    _min: { checkLimit: true, monthlyPrice: true },
    _max: { checkLimit: true, monthlyPrice: true }
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
