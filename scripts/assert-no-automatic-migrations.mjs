import { readFile } from "node:fs/promises";

const forbidden = /\bprisma\s+(?:migrate(?:\s+(?:deploy|dev|reset))?|db\s+push)\b/i;

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const inspectScripts = async (path) => {
  const pkg = await readJson(path);
  const violations = [];
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (!/(?:build|deploy|start|postinstall|prepare|install)/i.test(name)) continue;
    if (typeof command === "string" && forbidden.test(command)) {
      violations.push(`${path}#scripts.${name}: ${command}`);
    }
  }
  return violations;
};

const inspectText = async (path) => {
  const text = await readFile(path, "utf8");
  return forbidden.test(text) ? [`${path}: automatic migration command found`] : [];
};

const checks = await Promise.all([
  inspectScripts("package.json"),
  inspectScripts("apps/api/package.json"),
  inspectScripts("apps/web/package.json"),
  inspectText("apps/api/vercel.json"),
  inspectText(".github/workflows/ci.yml")
]);

const violations = checks.flat();
if (violations.length > 0) {
  console.error("OpsWatch Rule 6 violation: automatic database migration detected.");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("OpsWatch Rule 6 check passed: builds and normal CI contain no database migration command.");
