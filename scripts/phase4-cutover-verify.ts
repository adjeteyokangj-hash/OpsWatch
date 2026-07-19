/**
 * Phase 4 cutover dry-run: verify canonical topology read via the running API.
 * LOCAL ONLY. Does not push or deploy. Read-only against the API.
 */
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const apiBase = (process.env.CUTOVER_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";
const projectId = process.env.CUTOVER_PROJECT_ID || "app-noble-express";

const main = async () => {
  const loginRes = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const setCookies =
    typeof loginRes.headers.getSetCookie === "function"
      ? loginRes.headers.getSetCookie()
      : [];
  const cookieHeader = setCookies
    .map((row) => row.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!/opswatch_session=/.test(cookieHeader)) {
    throw new Error(`login missing opswatch_session cookie; got: ${cookieHeader}`);
  }

  const topoRes = await fetch(`${apiBase}/api/projects/${projectId}/topology`, {
    headers: { cookie: cookieHeader }
  });
  if (!topoRes.ok) {
    throw new Error(`topology fetch failed: ${topoRes.status} ${await topoRes.text()}`);
  }
  const topo = (await topoRes.json()) as {
    nodes: Array<{ id: string; type: string; status: string }>;
    edges: Array<{ id: string; type: string; status: string; sourceId: string; targetId: string }>;
    summary: Record<string, number>;
    otelOverlay?: Record<string, number | boolean>;
    readerDiagnostic?: Record<string, unknown>;
    nodeContext: Record<string, unknown>;
  };

  const layerCounts: Record<string, number> = {};
  for (const node of topo.nodes) {
    layerCounts[node.type] = (layerCounts[node.type] ?? 0) + 1;
  }
  const edgeTypeCounts: Record<string, number> = {};
  for (const edge of topo.edges) {
    edgeTypeCounts[edge.type] = (edgeTypeCounts[edge.type] ?? 0) + 1;
  }
  const statusCounts: Record<string, number> = {};
  for (const node of topo.nodes) {
    statusCounts[node.status] = (statusCounts[node.status] ?? 0) + 1;
  }

  const report = {
    projectId,
    nodeCount: topo.nodes.length,
    edgeCount: topo.edges.length,
    layerCounts,
    edgeTypeCounts,
    statusCounts,
    summary: topo.summary,
    otelOverlay: topo.otelOverlay,
    readerDiagnostic: topo.readerDiagnostic
  };
  console.log(JSON.stringify(report, null, 2));

  const diag = topo.readerDiagnostic as
    | { reader?: string; fallbackUsed?: boolean; unresolvedCanonicalReferences?: number }
    | undefined;
  if (!diag) {
    console.error("FAIL: no readerDiagnostic present (NODE_ENV=production or old build)");
    process.exitCode = 1;
    return;
  }
  if (diag.reader !== "CANONICAL") {
    console.error(`FAIL: reader is ${diag.reader}, expected CANONICAL`);
    process.exitCode = 1;
    return;
  }
  if (diag.fallbackUsed) {
    console.error("FAIL: fallbackUsed=true (whole-loader legacy fallback occurred)");
    process.exitCode = 1;
    return;
  }
  console.log("PASS: canonical reader active, no whole-loader fallback");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
