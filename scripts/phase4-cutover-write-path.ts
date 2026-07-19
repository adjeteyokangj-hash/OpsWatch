/**
 * Phase 4 cutover write-path test (LOCAL ONLY, temporary data).
 *
 * Exercises the canonical write paths while canonical reading is active:
 *   - register a temporary URL-monitored application (HTTP + SSL checks)
 *   - send a heartbeat (APP canonical entity)
 *   - ingest controlled OTEL evidence (OTEL_BRIDGE entities + OTEL_COLLECTOR relationship)
 *   - create/update a manual canonical entity + relationship
 *   - confirm the live canonical topology reader reflects the writes
 *   - confirm NO legacy ServiceDependency rows were required for canonical relationships
 *
 * Run with `--cleanup` to remove all temporary data.
 * Does not push or deploy.
 */
import { randomUUID, createHash } from "crypto";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const TEMP_PROJECT_ID = "zz-cutover-temp";
const TEMP_TAG = "phase4-cutover-temp";
const apiBase = (process.env.CUTOVER_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";
const ORG_ID = process.env.CUTOVER_ORG_ID || "org-okanggroup";
const ENV = "production";

const rid = (p: string) => `${p}_${createHash("sha256").update(TEMP_PROJECT_ID + p).digest("hex").slice(0, 24)}`;

const cleanup = async (prisma: any) => {
  await prisma.operationalRelationship.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.operationalEntityIdentity.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.legacyDependencyRelationshipMapping.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.legacyServiceEntityMapping.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.operationalEntity.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.normalizedOperationalSignal.deleteMany({ where: { projectId: TEMP_PROJECT_ID } }).catch(() => undefined);
  await prisma.heartbeat.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.checkResult.deleteMany({ where: { Check: { Service: { projectId: TEMP_PROJECT_ID } } } }).catch(() => undefined);
  await prisma.check.deleteMany({ where: { Service: { projectId: TEMP_PROJECT_ID } } });
  await prisma.serviceDependency.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.service.deleteMany({ where: { projectId: TEMP_PROJECT_ID } });
  await prisma.connection.deleteMany({ where: { projectId: TEMP_PROJECT_ID } }).catch(() => undefined);
  await prisma.alert.deleteMany({ where: { projectId: TEMP_PROJECT_ID } }).catch(() => undefined);
  await prisma.project.deleteMany({ where: { id: TEMP_PROJECT_ID } });
};

const login = async (): Promise<string> => {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return setCookies.map((r) => r.split(";")[0]).filter(Boolean).join("; ");
};

const readTopology = async (cookie: string, projectId: string) => {
  const res = await fetch(`${apiBase}/api/projects/${projectId}/topology`, { headers: { cookie } });
  if (!res.ok) throw new Error(`topology read failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  if (process.argv.includes("--cleanup")) {
    await cleanup(prisma);
    console.log("cleanup complete for temp project", TEMP_PROJECT_ID);
    await prisma.$disconnect();
    return;
  }

  // Fresh start
  await cleanup(prisma);

  // 1. Temp project
  await prisma.project.create({
    data: {
      id: TEMP_PROJECT_ID,
      name: "ZZ Cutover Temp",
      slug: `${TEMP_PROJECT_ID}-${Date.now()}`,
      clientName: TEMP_TAG,
      environment: ENV,
      status: "UNKNOWN",
      organizationId: ORG_ID,
      apiKey: `key_${randomUUID()}`,
      signingSecret: randomUUID(),
      updatedAt: new Date()
    }
  });

  const { provisionUrlMonitoring } = await import(
    "../apps/api/src/services/url-monitoring-provisioning.service"
  );
  const { ingestHeartbeat } = await import("../apps/api/src/services/heartbeats.service");
  const { canonicalGraph } = await import("../apps/api/src/services/canonical-graph.service");

  const result: Record<string, unknown> = { tempProjectId: TEMP_PROJECT_ID };

  // 2. URL-monitored application (creates Service + HTTP/SSL checks + canonical WEBSITE entity)
  let provisioned: any;
  try {
    provisioned = await provisionUrlMonitoring({
      organizationId: ORG_ID,
      projectId: TEMP_PROJECT_ID,
      projectName: "ZZ Cutover Temp",
      environment: ENV,
      role: "PUBLIC",
      url: "https://example.com",
      createdBy: null
    });
    result.urlMonitoring = {
      serviceId: provisioned.serviceId,
      operationalEntityId: provisioned.operationalEntityId,
      httpCheckId: provisioned.httpCheckId,
      sslCheckId: provisioned.sslCheckId
    };
  } catch (error) {
    result.urlMonitoringError = error instanceof Error ? error.message : String(error);
  }

  // 3. Heartbeat (APP canonical entity)
  await ingestHeartbeat(TEMP_PROJECT_ID, {
    environment: ENV,
    status: "UP",
    message: `${TEMP_TAG} heartbeat`
  });

  // 4. Controlled OTEL evidence: two OTEL_BRIDGE entities + OTEL_COLLECTOR relationship
  const otelSource = await canonicalGraph.upsertEntity({
    organizationId: ORG_ID,
    projectId: TEMP_PROJECT_ID,
    environment: ENV,
    entityType: "SERVICE",
    stableKey: "cutover-temp-otel-frontend",
    name: "cutover-temp-otel-frontend",
    source: "OTEL_BRIDGE",
    sourceKey: "cutover-temp-otel-frontend",
    provenance: "OTEL_COLLECTOR",
    health: "HEALTHY",
    confirmationState: "CONFIRMED",
    isTestSeed: true,
    freshUntil: new Date(Date.now() + 5 * 60_000)
  });
  const otelTarget = await canonicalGraph.upsertEntity({
    organizationId: ORG_ID,
    projectId: TEMP_PROJECT_ID,
    environment: ENV,
    entityType: "SERVICE",
    stableKey: "cutover-temp-otel-backend",
    name: "cutover-temp-otel-backend",
    source: "OTEL_BRIDGE",
    sourceKey: "cutover-temp-otel-backend",
    provenance: "OTEL_COLLECTOR",
    health: "DEGRADED",
    confirmationState: "CONFIRMED",
    isTestSeed: true,
    freshUntil: new Date(Date.now() + 5 * 60_000)
  });
  const otelRel = await canonicalGraph.upsertRelationship({
    organizationId: ORG_ID,
    projectId: TEMP_PROJECT_ID,
    environment: ENV,
    sourceEntityId: otelSource.id,
    targetEntityId: otelTarget.id,
    relationshipType: "DEPENDS_ON",
    source: "OTEL_BRIDGE",
    provenance: "OTEL_COLLECTOR",
    health: "DEGRADED",
    discoveryState: "ACTIVE",
    approvalStatus: "APPROVED",
    requiresApproval: false,
    confirmationState: "CONFIRMED",
    confidence: 0.9,
    latencyP95Ms: 240,
    errorRate: 0.04
  });
  result.otel = {
    sourceEntityId: otelSource.id,
    targetEntityId: otelTarget.id,
    relationshipId: otelRel.id
  };

  // 5. Manual canonical entity + relationship (no legacy ServiceDependency)
  const manualComponent = await canonicalGraph.upsertEntity({
    organizationId: ORG_ID,
    projectId: TEMP_PROJECT_ID,
    environment: ENV,
    entityType: "COMPONENT",
    stableKey: "cutover-temp-manual-cache",
    name: "cutover-temp-manual-cache",
    source: "MANUAL",
    provenance: "MANUAL",
    health: "HEALTHY",
    confirmationState: "CONFIRMED",
    manuallyManaged: true,
    isTestSeed: true
  });
  const manualRel = await canonicalGraph.upsertRelationship({
    organizationId: ORG_ID,
    projectId: TEMP_PROJECT_ID,
    environment: ENV,
    sourceEntityId: otelTarget.id,
    targetEntityId: manualComponent.id,
    relationshipType: "DEPENDS_ON",
    source: "MANUAL",
    provenance: "MANUAL",
    health: "HEALTHY",
    discoveryState: "ACTIVE",
    approvalStatus: "APPROVED",
    requiresApproval: false,
    confirmationState: "CONFIRMED",
    confidence: 1
  });
  result.manual = { componentId: manualComponent.id, relationshipId: manualRel.id };

  // Confirm NO legacy ServiceDependency rows exist for the temp project's canonical relationships
  const legacyDeps = await prisma.serviceDependency.count({ where: { projectId: TEMP_PROJECT_ID } });
  result.legacyServiceDependencyRows = legacyDeps;

  // 6. Read topology via the live canonical reader
  const cookie = await login();
  // allow the 8s topology cache to miss on first canonical read
  const topo: any = await readTopology(cookie, TEMP_PROJECT_ID);
  const nodeIds = new Set<string>((topo.nodes ?? []).map((n: any) => n.id));
  const edgePairs = new Set<string>(
    (topo.edges ?? []).map((e: any) => `${e.sourceId}->${e.targetId}:${e.type}`)
  );
  result.topology = {
    reader: topo.readerDiagnostic?.reader,
    fallbackUsed: topo.readerDiagnostic?.fallbackUsed,
    nodeCount: topo.nodes?.length ?? 0,
    edgeCount: topo.edges?.length ?? 0,
    otelOverlay: topo.otelOverlay,
    containsUrlEntity: provisioned ? nodeIds.has(provisioned.operationalEntityId) : "n/a",
    containsOtelSource: nodeIds.has(otelSource.id),
    containsOtelTarget: nodeIds.has(otelTarget.id),
    containsManualComponent: nodeIds.has(manualComponent.id),
    containsOtelRelationship: edgePairs.has(`${otelSource.id}->${otelTarget.id}:DEPENDENCY`),
    containsManualRelationship: edgePairs.has(`${otelTarget.id}->${manualComponent.id}:DEPENDENCY`)
  };

  console.log(JSON.stringify(result, null, 2));

  const t = result.topology as any;
  const ok =
    t.reader === "CANONICAL" &&
    t.fallbackUsed === false &&
    t.containsOtelSource &&
    t.containsOtelTarget &&
    t.containsManualComponent &&
    t.containsOtelRelationship &&
    t.containsManualRelationship &&
    legacyDeps === 0;
  console.log(ok ? "WRITE_PATH_PASS" : "WRITE_PATH_FAIL");
  if (!ok) process.exitCode = 1;

  await prisma.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
