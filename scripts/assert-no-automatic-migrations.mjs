import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const forbidden = /\bprisma\s+(?:migrate(?:\s+(?:deploy|dev|reset))?|db\s+(?:push|seed))\b|\b(?:apply|run)[-\w]*migration\b|\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|TYPE|INDEX)\b|\bINSERT\s+INTO\s+["']?_prisma_migrations\b/i;

const packages = ["package.json", "apps/api/package.json", "apps/web/package.json", "apps/worker/package.json", "packages/shared/package.json", "packages/opswatch-client/package.json"];
const seen = new Set();
const inspectHelper = async (path) => {
  path = resolve(path);
  if (seen.has(path)) return [];
  seen.add(path);
  let source;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    // Generated start targets are inspected through their TypeScript source.
    if (error.code !== "ENOENT" || !/[\\/]dist[\\/]/.test(path)) throw error;
    return inspectHelper(path.replace(/([\\/])dist([\\/])/, "$1src$2").replace(/\.js$/, ".ts"));
  }
  const violations = forbidden.test(source) ? [`${path}: migration helper reachable from lifecycle`] : [];
  for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']+\.(?:mjs|cjs|js|ts))["']/g)) {
    violations.push(...await inspectHelper(resolve(dirname(path), match[1])));
  }
  return violations;
};

const seenCommands = new Set();
const inspectCommand = async (command, path) => {
  const key = `${path}:${command}`;
  if (seenCommands.has(key)) return [];
  seenCommands.add(key);
  const violations = forbidden.test(command) ? [`${path}: automatic migration command`] : [];
  for (const match of command.matchAll(/(?:node|tsx|ts-node)\s+["']?([^\s"'&|;]+\.(?:mjs|cjs|js|ts))/g)) {
    violations.push(...await inspectHelper(resolve(dirname(path), match[1])));
  }
  for (const pkgPath of packages) {
    const pkg = await readJson(pkgPath);
    for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:pnpm|npm|yarn)\\b[^&|;\\n]*\\s(?:run\\s+)?${escaped}(?=\\s|$|[&|;])`).test(command)) {
        violations.push(...await inspectCommand(value, pkgPath));
      }
    }
  }
  return violations;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const inspectScripts = async (path) => {
  const pkg = await readJson(path);
  const violations = [];
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (!/(?:build|deploy|start|postinstall|prepare|install)/i.test(name)) continue;
    if (typeof command === "string") violations.push(...await inspectCommand(command, path));
  }
  return violations;
};

const inspectText = async (path) => {
  const text = await readFile(path, "utf8");
  return forbidden.test(text) ? [`${path}: automatic migration command found`] : [];
};

const checks = await Promise.all([
  ...packages.map(inspectScripts),
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
