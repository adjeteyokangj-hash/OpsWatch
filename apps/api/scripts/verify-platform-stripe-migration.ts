import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ILIKE '%stripe%'
  `;
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at FROM _prisma_migrations
    ORDER BY finished_at DESC LIMIT 8
  `;
  const platform = await prisma.platformStripeSettings.findMany();
  const orgStripeTable = tables.some((row) => row.tablename === "OrganizationStripeSettings");

  console.log(
    JSON.stringify(
      {
        stripeTables: tables.map((row) => row.tablename),
        organizationStripeTableExists: orgStripeTable,
        platformStripeRowCount: platform.length,
        platformStripeIds: platform.map((row) => row.id),
        recentMigrations: migrations.map((row) => row.migration_name)
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
