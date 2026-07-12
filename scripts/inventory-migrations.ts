import { PrismaClient } from "@prisma/client";

const listMigrations = async (label: string, url: string) => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY finished_at ASC NULLS LAST, migration_name ASC
    `;
    console.log(`\n=== ${label} (${rows.length} applied) ===`);
    for (const row of rows) {
      const finished = row.finished_at ? row.finished_at.toISOString() : "PENDING/FAILED";
      console.log(`${row.migration_name}\t${finished}`);
    }
    return rows.map((row) => row.migration_name);
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const localUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  if (!localUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const local = await listMigrations("Local DATABASE_URL", localUrl);

  if (directUrl && directUrl !== localUrl) {
    const remote = await listMigrations("DIRECT_URL (Supabase/session)", directUrl);
    const localSet = new Set(local);
    const remoteSet = new Set(remote);
    const onlyLocal = local.filter((name) => !remoteSet.has(name));
    const onlyRemote = remote.filter((name) => !localSet.has(name));
    console.log("\n=== Diff (local vs DIRECT_URL) ===");
    console.log(`Only local: ${onlyLocal.length ? onlyLocal.join(", ") : "(none)"}`);
    console.log(`Only remote: ${onlyRemote.length ? onlyRemote.join(", ") : "(none)"}`);
  } else {
    console.log("\n=== Supabase check ===");
    console.log("DIRECT_URL unset or identical to DATABASE_URL — remote history not queried separately.");
    console.log("Set DIRECT_URL to the Supabase session pooler URI to compare production migration history.");
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
