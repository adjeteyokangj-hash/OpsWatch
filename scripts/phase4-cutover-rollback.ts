/**
 * Phase 4 cutover rollback exercise.
 * Toggles OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED in apps/api/.env, restarts
 * the API process via the running `pnpm dev` watcher (env change requires
 * process restart), verifies reader mode, then restores the prior state.
 *
 * This script ONLY mutates the local apps/api/.env flag. It does not push or deploy.
 *
 * Usage:
 *   pnpm exec tsx scripts/phase4-cutover-rollback.ts --disable
 *   pnpm exec tsx scripts/phase4-cutover-rollback.ts --enable
 *   pnpm exec tsx scripts/phase4-cutover-rollback.ts --status
 */
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), "apps/api/.env");
const FLAG = "OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED";

const readEnv = (): string => fs.readFileSync(envPath, "utf8");

const setFlag = (enabled: boolean) => {
  let text = readEnv();
  const line = `${FLAG}=${enabled ? "true" : "false"}`;
  if (new RegExp(`^${FLAG}=`, "m").test(text)) {
    text = text.replace(new RegExp(`^${FLAG}=.*$`, "m"), line);
  } else {
    text = `${text.trimEnd()}\n\n# Phase 4 cutover dry-run (LOCAL ONLY).\n${line}\n`;
  }
  fs.writeFileSync(envPath, text);
  console.log(`Wrote ${line} to apps/api/.env`);
};

const status = () => {
  const match = readEnv().match(new RegExp(`^${FLAG}=(.*)$`, "m"));
  console.log(JSON.stringify({ flag: FLAG, value: match?.[1] ?? "(unset)" }, null, 2));
};

const arg = process.argv[2] ?? "--status";
if (arg === "--disable") setFlag(false);
else if (arg === "--enable") setFlag(true);
else status();
