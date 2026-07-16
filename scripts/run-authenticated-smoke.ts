/**
 * Run authenticated Playwright workspace smoke groups (expects API+web already up).
 *
 *   pnpm exec tsx scripts/run-authenticated-smoke.ts
 *   pnpm exec tsx scripts/run-authenticated-smoke.ts --repeat=3
 *   pnpm exec tsx scripts/run-authenticated-smoke.ts --full   # + org-isolation, connect, mobile
 */
import { spawnSync } from "child_process";
import path from "path";

const root = path.resolve(__dirname, "..");
const repeat = Math.max(
  1,
  Number((process.argv.find((a) => a.startsWith("--repeat=")) || "--repeat=1").split("=")[1])
);
const full = process.argv.includes("--full");

const workspaceProjects = [
  "--project=setup",
  "--project=smoke-auth",
  "--project=smoke-monitoring",
  "--project=smoke-operations",
  "--project=smoke-intelligence",
  "--project=smoke-configuration"
];

const run = (label: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}`);
  }
};

async function main() {
  run("wait-local-stack", "pnpm", ["exec", "tsx", "scripts/wait-local-stack.ts"]);
  run("ensure-smoke-fixtures", "pnpm", ["exec", "tsx", "scripts/ensure-smoke-fixtures.ts"]);

  const smokeEnv = {
    RUN_BROWSER_E2E: "true",
    PLAYWRIGHT_SKIP_WEB_SERVER: "true",
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    PLAYWRIGHT_API_URL: process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4000/api",
    PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    // Sent by e2e helpers; API honors only when non-prod + OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS.
    PLAYWRIGHT_E2E_RATE_LIMIT_BYPASS: process.env.PLAYWRIGHT_E2E_RATE_LIMIT_BYPASS || "true"
  };

  // Do not pass file paths with --project=… — Playwright then filters to those files only
  // and skips the workspace smoke groups. chromium project already picks non-smoke journeys.
  const args = ["--filter", "@opswatch/web", "exec", "playwright", "test", ...workspaceProjects];
  if (full) {
    args.push("--project=chromium");
  }

  for (let i = 1; i <= repeat; i += 1) {
    run(`authenticated-smoke #${i}/${repeat}`, "pnpm", args, smokeEnv);
    console.log(`AUTHENTICATED_SMOKE_PASS ${i}/${repeat}`);
  }
  console.log("AUTHENTICATED_SMOKE_ALL_PASS");
}

main().catch((error) => {
  console.error("AUTHENTICATED_SMOKE_FAIL", error);
  process.exitCode = 1;
});
