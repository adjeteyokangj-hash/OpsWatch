import {
  AlertSeverity,
  CheckStatus,
  CheckType,
  Prisma,
  ProjectStatus,
  ServiceType,
} from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { canonicalGraph } from "../canonical-graph.service";
import { createAlert, resolveAlertsBySourceId } from "../alerting.service";
import { backfillCanonicalTopology } from "../topology-unification.service";
import { clearTopologyLoaderCache } from "../topology-loader.service";

type RuntimeEvidenceStatus = "HEALTHY" | "DEGRADED" | "DOWN";
type RuntimeEndpointType = "MODULE" | "API" | "DATABASE" | "WORKER" | "COMPONENT";

export type RuntimeComponentEvidence = {
  key: string;
  name: string;
  serviceType: Exclude<RuntimeEndpointType, "MODULE">;
  status: RuntimeEvidenceStatus;
  criticality: "HIGH" | "MEDIUM";
  summary: string;
  metrics: Record<string, number | boolean | string | null>;
};

export type RuntimeDependencyEvidence = {
  key: string;
  source: { name: string; type: RuntimeEndpointType };
  target: { name: string; type: RuntimeEndpointType };
  criticality: "HIGH" | "MEDIUM";
  summary: string;
};

export type SignedRuntimeEvidence = {
  schemaVersion: "1.0";
  source: "truenumeris-runtime";
  generatedAt: string;
  applicationStatus: RuntimeEvidenceStatus;
  summary: string;
  components: RuntimeComponentEvidence[];
  dependencies: RuntimeDependencyEvidence[];
};

export type RuntimeEvidenceIngestResult = {
  ingested: boolean;
  components: number;
  dependencies: number;
  checkResults: number;
  alertsOpened: number;
  alertsResolved: number;
  structuralChanges: number;
};

const ALLOWED_COMPONENT_TYPES = new Set(["API", "DATABASE", "WORKER", "COMPONENT"]);
const ALLOWED_ENDPOINT_TYPES = new Set(["MODULE", ...ALLOWED_COMPONENT_TYPES]);
const ALLOWED_STATUSES = new Set(["HEALTHY", "DEGRADED", "DOWN"]);
const ALLOWED_CRITICALITIES = new Set(["HIGH", "MEDIUM"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return normalized;
};

const readKey = (value: unknown, label: string): string => {
  const key = readString(value, label, 100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`${label} must be lowercase kebab-case`);
  }
  return key;
};

const readStatus = (value: unknown, label: string): RuntimeEvidenceStatus => {
  const status = String(value || "").trim().toUpperCase();
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`${label} must be HEALTHY, DEGRADED or DOWN`);
  }
  return status as RuntimeEvidenceStatus;
};

const readCriticality = (value: unknown, label: string): "HIGH" | "MEDIUM" => {
  const criticality = String(value || "").trim().toUpperCase();
  if (!ALLOWED_CRITICALITIES.has(criticality)) {
    throw new Error(`${label} must be HIGH or MEDIUM`);
  }
  return criticality as "HIGH" | "MEDIUM";
};

const readEndpointType = (value: unknown, label: string): RuntimeEndpointType => {
  const type = String(value || "").trim().toUpperCase();
  if (!ALLOWED_ENDPOINT_TYPES.has(type)) {
    throw new Error(`${label} is not a supported runtime endpoint type`);
  }
  return type as RuntimeEndpointType;
};

const readMetrics = (value: unknown): Record<string, number | boolean | string | null> => {
  if (!isRecord(value)) return {};
  const metrics: Record<string, number | boolean | string | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 40)) {
    const key = rawKey.trim().slice(0, 80);
    if (!key) continue;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) metrics[key] = rawValue;
    else if (typeof rawValue === "boolean") metrics[key] = rawValue;
    else if (typeof rawValue === "string") metrics[key] = rawValue.slice(0, 200);
    else if (rawValue === null) metrics[key] = null;
  }
  return metrics;
};

export const parseSignedRuntimeEvidence = (payload: unknown): SignedRuntimeEvidence | null => {
  if (!isRecord(payload)) return null;
  const candidate = payload.opswatchEvidence;
  if (candidate == null) return null;
  if (!isRecord(candidate)) throw new Error("opswatchEvidence must be an object");
  if (candidate.schemaVersion !== "1.0") throw new Error("Unsupported runtime evidence schema version");
  if (candidate.source !== "truenumeris-runtime") throw new Error("Unsupported runtime evidence source");
  if (!Array.isArray(candidate.components) || candidate.components.length > 20) {
    throw new Error("opswatchEvidence.components must contain at most 20 items");
  }
  if (!Array.isArray(candidate.dependencies) || candidate.dependencies.length > 100) {
    throw new Error("opswatchEvidence.dependencies must contain at most 100 items");
  }

  const componentKeys = new Set<string>();
  const components = candidate.components.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`components[${index}] must be an object`);
    const key = readKey(raw.key, `components[${index}].key`);
    if (componentKeys.has(key)) throw new Error(`Duplicate component key: ${key}`);
    componentKeys.add(key);
    const serviceType = readEndpointType(raw.serviceType, `components[${index}].serviceType`);
    if (serviceType === "MODULE") throw new Error(`components[${index}].serviceType cannot be MODULE`);
    return {
      key,
      name: readString(raw.name, `components[${index}].name`, 120),
      serviceType,
      status: readStatus(raw.status, `components[${index}].status`),
      criticality: readCriticality(raw.criticality, `components[${index}].criticality`),
      summary: readString(raw.summary, `components[${index}].summary`, 500),
      metrics: readMetrics(raw.metrics),
    } satisfies RuntimeComponentEvidence;
  });

  const dependencyKeys = new Set<string>();
  const dependencies = candidate.dependencies.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`dependencies[${index}] must be an object`);
    if (!isRecord(raw.source) || !isRecord(raw.target)) {
      throw new Error(`dependencies[${index}] endpoints must be objects`);
    }
    const key = readKey(raw.key, `dependencies[${index}].key`);
    if (dependencyKeys.has(key)) throw new Error(`Duplicate dependency key: ${key}`);
    dependencyKeys.add(key);
    return {
      key,
      source: {
        name: readString(raw.source.name, `dependencies[${index}].source.name`, 120),
        type: readEndpointType(raw.source.type, `dependencies[${index}].source.type`),
      },
      target: {
        name: readString(raw.target.name, `dependencies[${index}].target.name`, 120),
        type: readEndpointType(raw.target.type, `dependencies[${index}].target.type`),
      },
      criticality: readCriticality(raw.criticality, `dependencies[${index}].criticality`),
      summary: readString(raw.summary, `dependencies[${index}].summary`, 500),
    } satisfies RuntimeDependencyEvidence;
  });

  const generatedAt = readString(candidate.generatedAt, "opswatchEvidence.generatedAt", 80);
  if (Number.isNaN(new Date(generatedAt).getTime())) {
    throw new Error("opswatchEvidence.generatedAt must be a valid date");
  }

  return {
    schemaVersion: "1.0",
    source: "truenumeris-runtime",
    generatedAt,
    applicationStatus: readStatus(candidate.applicationStatus, "opswatchEvidence.applicationStatus"),
    summary: readString(candidate.summary, "opswatchEvidence.summary", 500),
    components,
    dependencies,
  };
};

export const runtimeEvidenceCheckStatus = (status: RuntimeEvidenceStatus): CheckStatus =>
  status === "DOWN" ? CheckStatus.FAIL : status === "DEGRADED" ? CheckStatus.WARN : CheckStatus.PASS;

const runtimeServiceStatus = (status: RuntimeEvidenceStatus): ProjectStatus =>
  status === "DOWN" ? ProjectStatus.DOWN : status === "DEGRADED" ? ProjectStatus.DEGRADED : ProjectStatus.HEALTHY;

const stableId = (prefix: string, ...parts: string[]): string =>
  `${prefix}-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 28)}`;

const identityKey = (type: RuntimeEndpointType, name: string): string =>
  `${type}:${name.trim().toLowerCase()}`;

const metricNumber = (metrics: Record<string, number | boolean | string | null>, key: string): number | null => {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const canonicalHealth = (status: RuntimeEvidenceStatus): string =>
  status === "DOWN" ? "CRITICAL" : status;

export const ingestSignedRuntimeEvidence = async (input: {
  projectId: string;
  organizationId: string;
  environment: string;
  payload: unknown;
  observedAt: Date;
}): Promise<RuntimeEvidenceIngestResult> => {
  const evidence = parseSignedRuntimeEvidence(input.payload);
  if (!evidence) {
    return { ingested: false, components: 0, dependencies: 0, checkResults: 0, alertsOpened: 0, alertsResolved: 0, structuralChanges: 0 };
  }

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, environment: true },
  });
  if (!project) throw new Error("Runtime evidence project was not found");

  const endpointNames = Array.from(new Set(evidence.dependencies.flatMap((dependency) => [dependency.source.name, dependency.target.name])));
  const componentRows = new Map<string, { id: string; name: string; type: ServiceType; component: RuntimeComponentEvidence }>();
  const dependencyRows: Array<{ id: string; sourceServiceId: string; targetServiceId: string; dependency: RuntimeDependencyEvidence }> = [];
  let structuralChanges = 0;
  let checkResults = 0;

  await prisma.$transaction(async (tx) => {
    const existingEndpoints = await tx.service.findMany({
      where: { projectId: input.projectId, name: { in: endpointNames } },
      select: { id: true, name: true, type: true },
    });
    const servicesByIdentity = new Map(existingEndpoints.map((service) => [identityKey(service.type as RuntimeEndpointType, service.name), service]));

    for (const component of evidence.components) {
      const deterministicId = stableId("svc-runtime", input.projectId, component.key);
      const type = component.serviceType as ServiceType;
      const existing = servicesByIdentity.get(identityKey(component.serviceType, component.name)) ??
        (await tx.service.findFirst({
          where: { projectId: input.projectId, OR: [{ id: deterministicId }, { name: component.name, type }] },
          select: { id: true, name: true, type: true },
        }));

      const service = existing
        ? await tx.service.update({
            where: { id: existing.id },
            data: {
              name: component.name,
              type,
              status: runtimeServiceStatus(component.status),
              criticality: component.criticality,
              isCritical: component.criticality === "HIGH",
              ownerTeam: "Runtime Evidence",
              updatedAt: input.observedAt,
            },
            select: { id: true, name: true, type: true },
          })
        : await tx.service.create({
            data: {
              id: deterministicId,
              projectId: input.projectId,
              name: component.name,
              type,
              status: runtimeServiceStatus(component.status),
              criticality: component.criticality,
              isCritical: component.criticality === "HIGH",
              ownerTeam: "Runtime Evidence",
              updatedAt: input.observedAt,
            },
            select: { id: true, name: true, type: true },
          });

      if (!existing) structuralChanges += 1;
      servicesByIdentity.set(identityKey(component.serviceType, component.name), service);
      componentRows.set(component.key, { ...service, component });

      const checkName = `${component.name} - Signed runtime evidence`;
      let check = await tx.check.findFirst({ where: { serviceId: service.id, name: checkName }, select: { id: true } });
      if (!check) {
        check = await tx.check.create({
          data: {
            id: stableId("chk-runtime", input.projectId, component.key),
            serviceId: service.id,
            name: checkName,
            type: CheckType.HEARTBEAT_STALE,
            intervalSeconds: 60,
            timeoutMs: 5000,
            failureThreshold: 1,
            recoveryThreshold: 1,
            configJson: { source: "SIGNED_RUNTIME_EVIDENCE", componentKey: component.key } as Prisma.InputJsonValue,
            isActive: false,
            updatedAt: input.observedAt,
          },
          select: { id: true },
        });
        structuralChanges += 1;
      }

      await tx.checkResult.create({
        data: {
          id: randomUUID(),
          checkId: check.id,
          status: runtimeEvidenceCheckStatus(component.status),
          responseCode: component.status === "DOWN" ? 503 : 200,
          responseTimeMs: metricNumber(component.metrics, "latencyMs"),
          message: component.summary,
          checkedAt: input.observedAt,
        },
      });
      checkResults += 1;

      await tx.coverageTarget.upsert({
        where: { projectId_targetKey: { projectId: input.projectId, targetKey: `runtime:${component.key}` } },
        create: {
          id: stableId("cov-runtime", input.projectId, component.key),
          projectId: input.projectId,
          targetType: "SERVICE_HEALTH",
          targetKey: `runtime:${component.key}`,
          label: component.name,
          criticality: component.criticality,
          isCovered: true,
          coverageSource: "SIGNED_RUNTIME_EVIDENCE",
          detailsJson: { serviceType: component.serviceType, source: evidence.source, metrics: component.metrics } as Prisma.InputJsonValue,
          updatedAt: input.observedAt,
        },
        update: {
          label: component.name,
          criticality: component.criticality,
          isCovered: true,
          coverageSource: "SIGNED_RUNTIME_EVIDENCE",
          detailsJson: { serviceType: component.serviceType, source: evidence.source, metrics: component.metrics } as Prisma.InputJsonValue,
          updatedAt: input.observedAt,
        },
      });
    }

    for (const dependency of evidence.dependencies) {
      const source = servicesByIdentity.get(identityKey(dependency.source.type, dependency.source.name));
      const target = servicesByIdentity.get(identityKey(dependency.target.type, dependency.target.name));
      if (!source || !target || source.id === target.id) continue;

      const existing = await tx.serviceDependency.findUnique({
        where: { fromServiceId_toServiceId_dependencyType: { fromServiceId: source.id, toServiceId: target.id, dependencyType: "DEPENDENCY" } },
        select: { id: true },
      });
      const dependencyId = existing?.id ?? stableId("dep-runtime", input.projectId, dependency.key, source.id, target.id);
      await tx.serviceDependency.upsert({
        where: { fromServiceId_toServiceId_dependencyType: { fromServiceId: source.id, toServiceId: target.id, dependencyType: "DEPENDENCY" } },
        update: {
          projectId: input.projectId,
          criticality: dependency.criticality,
          isActive: true,
          source: "SIGNED_RUNTIME_EVIDENCE",
          evidenceCount: { increment: 1 },
          evidenceStrength: 1,
          lastObservedAt: input.observedAt,
          updatedAt: input.observedAt,
        },
        create: {
          id: dependencyId,
          projectId: input.projectId,
          fromServiceId: source.id,
          toServiceId: target.id,
          dependencyType: "DEPENDENCY",
          criticality: dependency.criticality,
          isActive: true,
          source: "SIGNED_RUNTIME_EVIDENCE",
          evidenceCount: 1,
          evidenceStrength: 1,
          lastObservedAt: input.observedAt,
          updatedAt: input.observedAt,
        },
      });
      if (!existing) structuralChanges += 1;
      dependencyRows.push({ id: dependencyId, sourceServiceId: source.id, targetServiceId: target.id, dependency });
    }
  });

  if (structuralChanges > 0) await backfillCanonicalTopology({ projectId: input.projectId });

  const allServiceIds = Array.from(new Set([
    ...Array.from(componentRows.values()).map((row) => row.id),
    ...dependencyRows.flatMap((row) => [row.sourceServiceId, row.targetServiceId]),
  ]));
  const mappings = await prisma.legacyServiceEntityMapping.findMany({
    where: { organizationId: input.organizationId, projectId: input.projectId, status: "ACTIVE", legacyServiceId: { in: allServiceIds } },
    select: { legacyServiceId: true, entityId: true },
  });
  const entityByServiceId = new Map(mappings.map((mapping) => [mapping.legacyServiceId, mapping.entityId]));

  for (const row of componentRows.values()) {
    await canonicalGraph.upsertEntity({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: project.environment || input.environment || "unknown",
      entityType: row.type,
      stableKey: `legacy-service:${row.id}`,
      name: row.name,
      source: "SIGNED_RUNTIME_EVIDENCE",
      sourceKey: row.component.key,
      provenance: "DISCOVERED",
      criticality: row.component.criticality,
      health: canonicalHealth(row.component.status),
      healthReason: row.component.summary,
      healthConfidence: 1,
      observedAt: input.observedAt,
      freshUntil: new Date(input.observedAt.getTime() + 3 * 60_000),
      confirmationState: "CONFIRMED",
      confidence: 1,
      metadata: { source: evidence.source, componentKey: row.component.key, metrics: row.component.metrics } as Prisma.InputJsonValue,
      compatibilityEntityId: entityByServiceId.get(row.id),
      legacyServiceId: row.id,
    });
  }

  const componentStatusByServiceId = new Map(Array.from(componentRows.values()).map((row) => [row.id, row.component.status]));
  const componentMetricsByServiceId = new Map(Array.from(componentRows.values()).map((row) => [row.id, row.component.metrics]));

  for (const row of dependencyRows) {
    const sourceEntityId = entityByServiceId.get(row.sourceServiceId);
    const targetEntityId = entityByServiceId.get(row.targetServiceId);
    if (!sourceEntityId || !targetEntityId) continue;
    const targetStatus = componentStatusByServiceId.get(row.targetServiceId) ?? evidence.applicationStatus;
    await canonicalGraph.upsertRelationship({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: project.environment || input.environment || "unknown",
      sourceEntityId,
      targetEntityId,
      relationshipType: "DEPENDENCY",
      source: "SIGNED_RUNTIME_EVIDENCE",
      provenance: "DISCOVERED",
      observedAt: input.observedAt,
      freshUntil: new Date(input.observedAt.getTime() + 3 * 60_000),
      health: canonicalHealth(targetStatus),
      confidence: 1,
      criticality: row.dependency.criticality,
      confirmationState: "CONFIRMED",
      approvalStatus: "APPROVED",
      discoveryState: "ACTIVE",
      evidence: {
        source: evidence.source,
        dependencyKey: row.dependency.key,
        summary: row.dependency.summary,
        targetMetrics: componentMetricsByServiceId.get(row.targetServiceId) ?? {},
      } as Prisma.InputJsonValue,
    });
  }

  let alertsOpened = 0;
  let alertsResolved = 0;
  for (const row of componentRows.values()) {
    if (row.component.status === "HEALTHY") {
      alertsResolved += await resolveAlertsBySourceId(input.projectId, "RUNTIME_EVIDENCE", row.component.key);
      continue;
    }
    const result = await createAlert({
      projectId: input.projectId,
      serviceId: row.id,
      sourceType: "RUNTIME_EVIDENCE",
      sourceId: row.component.key,
      severity: row.component.status === "DOWN" ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
      title: `${row.component.name} runtime evidence`,
      message: row.component.summary,
      dedupeBySourceId: true,
    });
    if (result.created) alertsOpened += 1;
  }

  clearTopologyLoaderCache();
  return {
    ingested: true,
    components: componentRows.size,
    dependencies: dependencyRows.length,
    checkResults,
    alertsOpened,
    alertsResolved,
    structuralChanges,
  };
};
