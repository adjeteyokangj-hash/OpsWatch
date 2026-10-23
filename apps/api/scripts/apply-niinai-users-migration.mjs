import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

// Explicit maintenance only: verify approval before configuration or connection.
await import("../../../scripts/guard-db-migration.mjs");

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, "../.env") });

const migrationName = "20261017143000_niinai_users_sessions";
const sqlPath = join(here, "../prisma/migrations", migrationName, "migration.sql");

const redact = (message, secret) => {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
};

const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString || connectionString === "[SENSITIVE]") {
  console.error("NiiNai users migration needs DIRECT_URL or DATABASE_URL in the deployment environment.");
  process.exit(1);
}

const sql = readFileSync(sqlPath);
const checksum = createHash("sha256").update(sql).digest("hex");
const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
    ? undefined
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000
});

try {
  await client.connect();
  const existing = await client.query(`select to_regclass('public."MonitoredStaff"') as staff_table`);
  if (existing.rows[0]?.staff_table) {
    console.log("NiiNai users tables already exist.");
  } else {
    await client.query("begin");
    try {
      await client.query(sql.toString("utf8"));
      await client.query(
        `insert into "_prisma_migrations" (
           id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
         ) values ($1, $2, now(), $3, null, null, now(), 1)`,
        [randomUUID(), checksum, migrationName]
      );
      await client.query("commit");
      console.log("NiiNai users tables created.");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "migration failed";
  console.error(redact(message, connectionString));
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
