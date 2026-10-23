import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const guard = fileURLToPath(new URL("./assert-no-automatic-migrations.mjs", import.meta.url));
async function run(t, scripts, source = "console.log('build');") {
  const root = await mkdtemp(join(tmpdir(), "opswatch-guard-"));
  t.after(() => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("opswatch-guard-")) throw new Error("Unexpected test cleanup target");
    return rm(root, { recursive: true, force: true });
  });
  for (const dir of ["apps/api", "apps/web", "apps/worker", "packages/shared", "packages/opswatch-client", ".github/workflows"]) {
    await mkdir(join(root, dir), { recursive: true });
    if (!dir.startsWith(".github")) await writeFile(join(root, dir, "package.json"), "{}");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts }));
  await writeFile(join(root, "helper.mjs"), source);
  await writeFile(join(root, "nested.mjs"), 'db.query("ALTER TABLE sample ADD COLUMN value text");');
  await writeFile(join(root, "apps/api/vercel.json"), "{}");
  await writeFile(join(root, ".github/workflows/ci.yml"), "name: CI");
  return spawnSync(process.execPath, [guard], { cwd: root, encoding: "utf8" });
}
test("allows generation and explicit maintenance outside lifecycle", async t => {
  const result = await run(t, { build: "prisma generate", "db:migrate": "prisma migrate deploy" });
  assert.equal(result.status, 0, result.stderr);
});
test("rejects direct lifecycle migration", async t => {
  assert.equal((await run(t, { postinstall: "prisma migrate deploy" })).status, 1);
});
test("follows an alias into a SQL helper", async t => {
  const result = await run(t, { build: "pnpm maintenance", maintenance: "node helper.mjs" }, 'db.query("CREATE TABLE sample (id text)");');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /helper/);
});
test("follows a dynamic helper import", async t => {
  const result = await run(t, { build: "node helper.mjs" }, 'await import("./nested.mjs");');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nested/);
});
test("legacy helper refuses execution without approval before connecting", () => {
  const helper = fileURLToPath(new URL("../apps/api/scripts/apply-niinai-users-migration.mjs", import.meta.url));
  const env = { ...process.env, OPSWATCH_DB_MIGRATION_APPROVAL: "", DATABASE_URL: "", DIRECT_URL: "" };
  const result = spawnSync(process.execPath, [helper], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /migration blocked/i);
});
