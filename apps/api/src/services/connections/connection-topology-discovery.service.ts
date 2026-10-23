import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  joinConnectionUrl,
  validateConnectionConfiguration
} from "../connection-manifest.service";
import {
  assertSafeConnectionTarget,
  buildConnectionHeaders
} from "../agentless-connection.service";
import { resolveConnectionSecret } from "../credentials/connection-credential.service";
import { backfillCanonicalTopology } from "../topology-unification.service";

export type DeclaredModuleManifest = {
  key: string;
  name: string;
  category?: string;
  description: string;
  criticality: "HIGH" | "MEDIUM";
  routePrefixes: string[];
  externalId?: string;
};

export type TopologyComponentKind = "module" | "workflow" | "component" | "property" | "installation";
export type TopologyRelationshipKind = "hierarchy" | "depends_on" | "runs_on" | "syncs";
export type TopologyEvidenceProvenance = "verified" | "configured";
export type TopologyHealthSignal = "http_check" | "heartbeat_lane" | "unbound";

export type DeclaredTopologyComponent = {
  key: string;
  name: string;
  kind: TopologyComponentKind;
  category?: string;
  description: string;
  criticality: "HIGH" | "MEDIUM";
  routePrefixes: string[];
  parentKey?: string;
  externalId?: string;
};

export type DeclaredTopologyRelationship = {
  from: string;
  to: string;
  type: TopologyRelationshipKind;
  criticality: "HIGH" | "MEDIUM";
  provenance: TopologyEvidenceProvenance;
};

export type DeclaredHealthBinding = {
  componentKey: string;
  signal: TopologyHealthSignal;
  lane?: "lifecycle" | "financial";
  checkName?: string;
};

export type ConnectionTopologyManifest = {
  schemaVersion: "1.0" | "1.1";
  source: string;
  application: {
    key: string;
    name: string;
  };
  modules: DeclaredModuleManifest[];
  components?: DeclaredTopologyComponent[];
  relationships?: DeclaredTopologyRelationship[];
  healthBindings?: DeclaredHealthBinding[];
};

export type ConnectionTopologySyncResult = {
  status: "SUCCEEDED" | "SKIPPED";
  applicationId: string;
  moduleCount: number;
  componentCount: number;
  relationshipCount: number;
  hierarchyCount: number;
  canonicalEntitiesMapped: number;
  canonicalRelationshipsMapped: number;
  summary: string;
};

type ApiTopologyConnection = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  mode: string;
  environment: string | null;
  authMethod: string;
  configurationJson: unknown;
  credentialFamilyId: string | null;
  secretRef: string | null;
  managedSecretCiphertext: string | null;
  managedSecretIv: string | null;
  managedSecretAuthTag: string | null;
  syncIntervalMinutes?: number | null;
  lastSyncAt?: Date | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readRequiredString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters`);
  }
  return normalized;
};

const readKey = (value: unknown, label: string): string => {
  const key = readRequiredString(value, label, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`${label} must be a lowercase kebab-case key`);
  }
  return key;
};

const readOptionalCategory = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 80) return undefined;
  return normalized;
};

const readOptionalExternalId = (value: unknown, label: string): string | undefined => {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a UUID`);
  const id = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`${label} must be a UUID`);
  }
  return id;
};

const readRoutePrefixes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("/") && !entry.startsWith("//") && entry.length <= 240)
  )].slice(0, 50);
};

const manifestCandidate = (payload: unknown): unknown => {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.data) && payload.data.opswatchTopology !== undefined) {
    return payload.data.opswatchTopology;
  }
  return payload.opswatchTopology ?? null;
};

const COMPONENT_KINDS = new Set<TopologyComponentKind>([
  "module",
  "workflow",
  "component",
  "property",
  "installation"
]);
const RELATIONSHIP_KINDS = new Set<TopologyRelationshipKind>([
  "hierarchy",
  "depends_on",
  "runs_on",
  "syncs"
]);

const readCriticality = (value: unknown, label: string): "HIGH" | "MEDIUM" => {
  const criticality = String(value ?? "MEDIUM").toUpperCase();
  if (criticality !== "HIGH" && criticality !== "MEDIUM") {
    throw new Error(`${label} must be HIGH or MEDIUM`);
  }
  return criticality;
};

const readModule = (
  raw: unknown,
  index: number,
  seenKeys: Set<string>
): DeclaredModuleManifest => {
  if (!isRecord(raw)) throw new Error(`modules[${index}] must be an object`);
  const key = readKey(raw.key, `modules[${index}].key`);
  if (seenKeys.has(key)) throw new Error(`Duplicate module key: ${key}`);
  seenKeys.add(key);
  return {
    key,
    name: readRequiredString(raw.name, `modules[${index}].name`, 120),
    ...(readOptionalCategory(raw.category) ? { category: readOptionalCategory(raw.category) } : {}),
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : "",
    criticality: readCriticality(raw.criticality, `modules[${index}].criticality`),
    routePrefixes: readRoutePrefixes(raw.routePrefixes),
    ...(readOptionalExternalId(raw.externalId, `modules[${index}].externalId`)
      ? { externalId: readOptionalExternalId(raw.externalId, `modules[${index}].externalId`) }
      : {})
  };
};

const readComponent = (
  raw: unknown,
  index: number,
  seenKeys: Set<string>
): DeclaredTopologyComponent => {
  if (!isRecord(raw)) throw new Error(`components[${index}] must be an object`);
  const key = readKey(raw.key, `components[${index}].key`);
  if (seenKeys.has(key)) throw new Error(`Duplicate component key: ${key}`);
  seenKeys.add(key);
  const kind = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "";
  if (!COMPONENT_KINDS.has(kind as TopologyComponentKind)) {
    throw new Error(`components[${index}].kind is not supported`);
  }
  const parentKey = raw.parentKey == null || raw.parentKey === ""
    ? undefined
    : readKey(raw.parentKey, `components[${index}].parentKey`);
  if (parentKey === key) throw new Error(`components[${index}] cannot parent itself`);
  return {
    key,
    name: readRequiredString(raw.name, `components[${index}].name`, 120),
    kind: kind as TopologyComponentKind,
    ...(readOptionalCategory(raw.category) ? { category: readOptionalCategory(raw.category) } : {}),
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : "",
    criticality: readCriticality(raw.criticality, `components[${index}].criticality`),
    routePrefixes: readRoutePrefixes(raw.routePrefixes),
    ...(parentKey ? { parentKey } : {}),
    ...(readOptionalExternalId(raw.externalId, `components[${index}].externalId`)
      ? { externalId: readOptionalExternalId(raw.externalId, `components[${index}].externalId`) }
      : {})
  };
};

const readRelationship = (
  raw: unknown,
  index: number,
  knownKeys: Set<string>
): DeclaredTopologyRelationship => {
  if (!isRecord(raw)) throw new Error(`relationships[${index}] must be an object`);
  const from = readKey(raw.from, `relationships[${index}].from`);
  const to = readKey(raw.to, `relationships[${index}].to`);
  if (from === to) throw new Error(`relationships[${index}] cannot link a component to itself`);
  if (!knownKeys.has(from) || !knownKeys.has(to)) {
    throw new Error(`relationships[${index}] references an unknown component`);
  }
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
  if (!RELATIONSHIP_KINDS.has(type as TopologyRelationshipKind)) {
    throw new Error(`relationships[${index}].type is not supported`);
  }
  const provenance = typeof raw.provenance === "string" ? raw.provenance.trim().toLowerCase() : "verified";
  if (provenance !== "verified" && provenance !== "configured") {
    throw new Error(`relationships[${index}].provenance must be verified or configured`);
  }
  return {
    from,
    to,
    type: type as TopologyRelationshipKind,
    criticality: readCriticality(raw.criticality, `relationships[${index}].criticality`),
    provenance
  };
};

const readHealthBinding = (
  raw: unknown,
  index: number,
  knownKeys: Set<string>
): DeclaredHealthBinding => {
  if (!isRecord(raw)) throw new Error(`healthBindings[${index}] must be an object`);
  const componentKey = readKey(raw.componentKey, `healthBindings[${index}].componentKey`);
  if (!knownKeys.has(componentKey)) {
    throw new Error(`healthBindings[${index}] references an unknown component`);
  }
  const signal = typeof raw.signal === "string" ? raw.signal.trim().toLowerCase() : "";
  if (signal !== "http_check" && signal !== "heartbeat_lane" && signal !== "unbound") {
    throw new Error(`healthBindings[${index}].signal is not supported`);
  }
  const lane = raw.lane == null || raw.lane === ""
    ? undefined
    : String(raw.lane).trim().toLowerCase();
  if (signal === "heartbeat_lane" && lane !== "lifecycle" && lane !== "financial") {
    throw new Error(`healthBindings[${index}].lane must be lifecycle or financial`);
  }
  if (signal !== "heartbeat_lane" && lane) {
    throw new Error(`healthBindings[${index}].lane is only valid for a heartbeat lane`);
  }
  const checkName = typeof raw.checkName === "string" && raw.checkName.trim()
    ? raw.checkName.trim().slice(0, 120)
    : undefined;
  return {
    componentKey,
    signal,
    ...(lane === "lifecycle" || lane === "financial" ? { lane } : {}),
    ...(checkName ? { checkName } : {})
  };
};

export const parseConnectionTopologyManifest = (
  payload: unknown
): ConnectionTopologyManifest | null => {
  const candidate = manifestCandidate(payload);
  if (candidate == null) return null;
  if (!isRecord(candidate)) throw new Error("opswatchTopology must be an object");
  if (candidate.schemaVersion !== "1.0" && candidate.schemaVersion !== "1.1") {
    throw new Error("Unsupported OpsWatch topology schema version");
  }
  if (!isRecord(candidate.application)) {
    throw new Error("opswatchTopology.application must be an object");
  }
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion === "1.0" && !Array.isArray(candidate.modules)) {
    throw new Error("opswatchTopology.modules must be an array");
  }
  if (candidate.modules != null && !Array.isArray(candidate.modules)) {
    throw new Error("opswatchTopology.modules must be an array");
  }
  if (candidate.components != null && !Array.isArray(candidate.components)) {
    throw new Error("opswatchTopology.components must be an array");
  }
  if (candidate.relationships != null && !Array.isArray(candidate.relationships)) {
    throw new Error("opswatchTopology.relationships must be an array");
  }
  if (candidate.healthBindings != null && !Array.isArray(candidate.healthBindings)) {
    throw new Error("opswatchTopology.healthBindings must be an array");
  }

  const moduleRows = Array.isArray(candidate.modules) ? candidate.modules : [];
  const componentRows = Array.isArray(candidate.components) ? candidate.components : [];
  if (schemaVersion === "1.0" && componentRows.length > 0) {
    throw new Error("components require opswatchTopology schema version 1.1");
  }
  if (moduleRows.length + componentRows.length > 100) {
    throw new Error("opswatchTopology exceeds the 100 component safety limit");
  }

  const seenKeys = new Set<string>();
  const modules = moduleRows.map((raw, index) => readModule(raw, index, seenKeys));
  const components = componentRows.map((raw, index) => readComponent(raw, index, seenKeys));
  const applicationKey = readKey(candidate.application.key, "opswatchTopology.application.key");
  const knownKeys = new Set<string>([applicationKey, ...seenKeys]);
  for (const component of components) {
    if (component.parentKey && !knownKeys.has(component.parentKey)) {
      throw new Error(`Unknown parent key: ${component.parentKey}`);
    }
  }
  const relationships = (Array.isArray(candidate.relationships) ? candidate.relationships : [])
    .slice(0, 200)
    .map((raw, index) => readRelationship(raw, index, knownKeys));
  if (Array.isArray(candidate.relationships) && candidate.relationships.length > 200) {
    throw new Error("opswatchTopology.relationships exceeds the 200 relationship safety limit");
  }
  const healthBindings = (Array.isArray(candidate.healthBindings) ? candidate.healthBindings : [])
    .map((raw, index) => readHealthBinding(raw, index, knownKeys));

  return {
    schemaVersion,
    source: readRequiredString(candidate.source, "opswatchTopology.source", 80),
    application: {
      key: applicationKey,
      name: readRequiredString(candidate.application.name, "opswatchTopology.application.name", 120)
    },
    modules,
    components,
    relationships,
    healthBindings
  };
};

const topologyMetaJson = (input: {
  declaredKind: string;
  category?: string;
  externalId?: string;
  healthBinding?: DeclaredHealthBinding | null;
}) => ({
  declaredKind: input.declaredKind,
  category: input.category ?? null,
  externalId: input.externalId ?? null,
  healthBinding: input.healthBinding
    ? {
        signal: input.healthBinding.signal,
        lane: input.healthBinding.lane ?? null,
        checkName: input.healthBinding.checkName ?? null
      }
    : null
});

const stableId = (prefix: string, ...parts: string[]): string => {
  const digest = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 28);
  return `${prefix}-${digest}`;
};

const fetchManifestPayload = async (connection: ApiTopologyConnection): Promise<unknown> => {
  if (connection.mode !== "API") {
    throw new Error("Topology discovery is supported for API connections only");
  }
  const validated = validateConnectionConfiguration("API", connection.configurationJson);
  if (!validated.valid) throw new Error(validated.error);
  const discoveryPath = validated.value.discoveryPath;
  if (typeof discoveryPath !== "string" || !discoveryPath.trim()) {
    throw new Error("Configure discoveryPath before importing application structure");
  }

  const endpoint = new URL(String(validated.value.endpoint));
  const discoveryUrl = new URL(joinConnectionUrl(endpoint.origin, discoveryPath));
  if (discoveryUrl.origin !== endpoint.origin) {
    throw new Error("discoveryPath must stay on the configured endpoint origin");
  }
  await assertSafeConnectionTarget(discoveryUrl.toString());
  const secret = await resolveConnectionSecret(connection);
  const headers = buildConnectionHeaders(connection.authMethod, secret, validated.value);
  const controller = new AbortController();
  const timeoutMs = Number(validated.value.timeoutMs ?? 10_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(discoveryUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "manual"
    });
    if (!response.ok) {
      throw new Error(`Discovery endpoint returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const TOPOLOGY_TRANSACTION_MAX_WAIT_MS = 10_000;
const TOPOLOGY_TRANSACTION_TIMEOUT_MS = 30_000;

/** Transaction-pooler URLs cannot keep Prisma's interactive transaction open. */
export const topologyImportUsesSessionConnection = (
  databaseUrl = process.env.DATABASE_URL ?? "",
  directUrl = process.env.DIRECT_URL ?? ""
): boolean => {
  const pooled =
    /:6543(?:\/|\?|$)/.test(databaseUrl) ||
    /(?:^|[?&])pgbouncer=true(?:&|$)/i.test(databaseUrl);
  const direct = directUrl.trim();
  if (!pooled || !direct) return false;
  if (/:6543(?:\/|\?|$)/.test(direct) || /(?:^|[?&])pgbouncer=true(?:&|$)/i.test(direct)) {
    return false;
  }
  return true;
};

const singleSessionUrl = (directUrl: string): string => {
  if (/connection_limit=/i.test(directUrl)) {
    return directUrl.replace(/connection_limit=\d+/i, "connection_limit=1");
  }
  return `${directUrl}${directUrl.includes("?") ? "&" : "?"}connection_limit=1`;
};

const runTopologyImportTransaction = async (
  work: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> => {
  const options = {
    maxWait: TOPOLOGY_TRANSACTION_MAX_WAIT_MS,
    timeout: TOPOLOGY_TRANSACTION_TIMEOUT_MS
  };
  if (!topologyImportUsesSessionConnection()) {
    await prisma.$transaction(work, options);
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({
    datasources: { db: { url: singleSessionUrl(process.env.DIRECT_URL?.trim() ?? "") } }
  });
  try {
    await client.$transaction(work, options);
  } finally {
    await client.$disconnect();
  }
};

export const reconcileConnectionTopologyManifest = async (
  connection: ApiTopologyConnection,
  manifest: ConnectionTopologyManifest
): Promise<ConnectionTopologySyncResult> => {
  if (!connection.projectId) throw new Error("A project is required to import application structure");
  const project = await prisma.project.findFirst({
    where: {
      id: connection.projectId,
      organizationId: connection.organizationId
    },
    select: {
      id: true,
      organizationId: true,
      environment: true,
      name: true
    }
  });
  if (!project?.organizationId) throw new Error("Connected project was not found in the organization");

  const now = new Date();
  const sourcePrefix = `connection:${connection.id}`;
  let applicationId = "";
  let hierarchyCount = 0;
  let deactivatedCount = 0;
  let componentCount = 0;
  let relationshipCount = 0;

  await runTopologyImportTransaction(async (tx) => {
    const existingApp = await tx.service.findFirst({
      where: {
        projectId: project.id,
        type: "APP"
      },
      orderBy: { createdAt: "asc" }
    });
    const appId = existingApp?.id ?? stableId("svc-app", connection.id, manifest.application.key);
    const app = existingApp
      ? await tx.service.update({
          where: { id: existingApp.id },
          data: {
            name: manifest.application.name,
            criticality: "HIGH",
            isCritical: true,
            topologyMetaJson: topologyMetaJson({ declaredKind: "application" }),
            updatedAt: now
          }
        })
      : await tx.service.create({
          data: {
            id: appId,
            projectId: project.id,
            name: manifest.application.name,
            type: "APP",
            status: "UNKNOWN",
            criticality: "HIGH",
            isCritical: true,
            ownerTeam: "Platform Operations",
            topologyMetaJson: topologyMetaJson({ declaredKind: "application" }),
            updatedAt: now
          }
        });
    applicationId = app.id;

    const existingHierarchy = await tx.serviceDependency.findMany({
      where: {
        projectId: project.id,
        dependencyType: "HIERARCHY",
        source: "CONNECTION_DISCOVERY",
        toServiceId: app.id
      },
      select: {
        id: true,
        fromServiceId: true,
        isActive: true
      }
    });
    const discoveredModuleIds = [...new Set(existingHierarchy.map((dependency) => dependency.fromServiceId))];
    const existingDiscoveredModules = discoveredModuleIds.length
      ? await tx.service.findMany({
          where: {
            id: { in: discoveredModuleIds },
            projectId: project.id,
            type: "MODULE"
          }
        })
      : [];
    const discoveredById = new Map(existingDiscoveredModules.map((service) => [service.id, service]));
    const discoveredByName = new Map(existingDiscoveredModules.map((service) => [service.name, service]));
    const bindingByKey = new Map(
      (manifest.healthBindings ?? []).map((binding) => [binding.componentKey, binding])
    );
    const serviceIdByKey = new Map<string, string>([[manifest.application.key, app.id]]);
    const retainedModuleIds = new Set<string>();

    for (const module of manifest.modules) {
      const deterministicModuleId = stableId("svc-mod", connection.id, module.key);
      const existingModule =
        discoveredById.get(deterministicModuleId)
        ?? discoveredByName.get(module.name)
        ?? await tx.service.findFirst({
          where: {
            projectId: project.id,
            type: "MODULE",
            name: module.name
          }
        });
      const moduleRow = existingModule
        ? await tx.service.update({
            where: { id: existingModule.id },
            data: {
              name: module.name,
              criticality: module.criticality,
              isCritical: module.criticality === "HIGH",
              ownerTeam: "Platform Operations",
              topologyMetaJson: topologyMetaJson({
                declaredKind: "module",
                category: module.category,
                externalId: module.externalId,
                healthBinding: bindingByKey.get(module.key) ?? null
              }),
              updatedAt: now
            }
          })
        : await tx.service.create({
            data: {
              id: deterministicModuleId,
              projectId: project.id,
              name: module.name,
              type: "MODULE",
              status: "UNKNOWN",
              criticality: module.criticality,
              isCritical: module.criticality === "HIGH",
              ownerTeam: "Platform Operations",
              topologyMetaJson: topologyMetaJson({
                declaredKind: "module",
                category: module.category,
                externalId: module.externalId,
                healthBinding: bindingByKey.get(module.key) ?? null
              }),
              updatedAt: now
            }
          });
      retainedModuleIds.add(moduleRow.id);
      serviceIdByKey.set(module.key, moduleRow.id);

      await tx.serviceDependency.upsert({
        where: {
          fromServiceId_toServiceId_dependencyType: {
            fromServiceId: moduleRow.id,
            toServiceId: app.id,
            dependencyType: "HIERARCHY"
          }
        },
        update: {
          projectId: project.id,
          isActive: true,
          criticality: module.criticality,
          source: "CONNECTION_DISCOVERY",
          updatedAt: now
        },
        create: {
          id: stableId("dep-hier", connection.id, module.key, manifest.application.key),
          projectId: project.id,
          fromServiceId: moduleRow.id,
          toServiceId: app.id,
          dependencyType: "HIERARCHY",
          criticality: module.criticality,
          isActive: true,
          source: "CONNECTION_DISCOVERY",
          updatedAt: now
        }
      });
      hierarchyCount += 1;
    }

    for (const dependency of existingHierarchy) {
      if (retainedModuleIds.has(dependency.fromServiceId)) continue;
      await tx.serviceDependency.update({
        where: { id: dependency.id },
        data: {
          isActive: false,
          updatedAt: now
        }
      });
      deactivatedCount += 1;
    }

    const components = manifest.components ?? [];
    const relationships = manifest.relationships ?? [];
    const healthBindings = manifest.healthBindings ?? [];
    const componentServiceIds = new Set<string>();
    const retainedDependencyIds = new Set<string>();
    const serviceTypeForKind = (kind: TopologyComponentKind): "MODULE" | "WORKFLOW" | "COMPONENT" => {
      if (kind === "workflow") return "WORKFLOW";
      if (kind === "module" || kind === "property") return "MODULE";
      return "COMPONENT";
    };
    const dependencyTypeFor = (type: TopologyRelationshipKind): string => {
      if (type === "hierarchy") return "HIERARCHY";
      if (type === "depends_on") return "DEPENDS_ON";
      if (type === "runs_on") return "RUNS_ON";
      return "SYNCS";
    };
    const upsertLink = async (input: {
      id: string;
      fromServiceId: string;
      toServiceId: string;
      dependencyType: string;
      criticality: "HIGH" | "MEDIUM";
      source: "CONNECTION_DISCOVERY" | "MANUAL";
    }) => {
      const row = await tx.serviceDependency.upsert({
        where: {
          fromServiceId_toServiceId_dependencyType: {
            fromServiceId: input.fromServiceId,
            toServiceId: input.toServiceId,
            dependencyType: input.dependencyType
          }
        },
        update: {
          projectId: project.id,
          isActive: true,
          criticality: input.criticality,
          source: input.source,
          updatedAt: now
        },
        create: {
          id: input.id,
          projectId: project.id,
          fromServiceId: input.fromServiceId,
          toServiceId: input.toServiceId,
          dependencyType: input.dependencyType,
          criticality: input.criticality,
          isActive: true,
          source: input.source,
          updatedAt: now
        }
      });
      if (input.source === "CONNECTION_DISCOVERY") retainedDependencyIds.add(row.id);
      if (input.dependencyType === "HIERARCHY") hierarchyCount += 1;
      else relationshipCount += 1;
    };

    for (const component of components) {
      const deterministicId = stableId("svc-cmp", connection.id, component.key);
      const serviceType = serviceTypeForKind(component.kind);
      const existing =
        await tx.service.findFirst({ where: { id: deterministicId } })
        ?? await tx.service.findFirst({
          where: { projectId: project.id, type: serviceType, name: component.name }
        });
      const meta = topologyMetaJson({
        declaredKind: component.kind,
        category: component.category,
        externalId: component.externalId,
        healthBinding: bindingByKey.get(component.key) ?? null
      });
      const row = existing
        ? await tx.service.update({
            where: { id: existing.id },
            data: {
              name: component.name,
              type: serviceType,
              criticality: component.criticality,
              isCritical: component.criticality === "HIGH",
              ownerTeam: "Platform Operations",
              topologyMetaJson: meta,
              updatedAt: now
            }
          })
        : await tx.service.create({
            data: {
              id: deterministicId,
              projectId: project.id,
              name: component.name,
              type: serviceType,
              status: "UNKNOWN",
              criticality: component.criticality,
              isCritical: component.criticality === "HIGH",
              ownerTeam: "Platform Operations",
              topologyMetaJson: meta,
              updatedAt: now
            }
          });
      serviceIdByKey.set(component.key, row.id);
      componentServiceIds.add(row.id);
      componentCount += 1;
    }

    for (const component of components) {
      if (!component.parentKey) continue;
      const childId = serviceIdByKey.get(component.key);
      const parentId = serviceIdByKey.get(component.parentKey);
      if (!childId || !parentId) continue;
      await upsertLink({
        id: stableId("dep-parent", connection.id, component.key, component.parentKey),
        fromServiceId: childId,
        toServiceId: parentId,
        dependencyType: "HIERARCHY",
        criticality: component.criticality,
        source: "CONNECTION_DISCOVERY"
      });
    }

    for (const relationship of relationships) {
      const fromServiceId = serviceIdByKey.get(relationship.from);
      const toServiceId = serviceIdByKey.get(relationship.to);
      if (!fromServiceId || !toServiceId) continue;
      await upsertLink({
        id: stableId("dep-rel", connection.id, relationship.from, relationship.to, relationship.type),
        fromServiceId,
        toServiceId,
        dependencyType: dependencyTypeFor(relationship.type),
        criticality: relationship.criticality,
        source: relationship.provenance === "configured" ? "MANUAL" : "CONNECTION_DISCOVERY"
      });
    }

    if (componentServiceIds.size > 0) {
      const managed = await tx.serviceDependency.findMany({
        where: {
          projectId: project.id,
          source: "CONNECTION_DISCOVERY",
          OR: [
            { fromServiceId: { in: [...componentServiceIds] } },
            { toServiceId: { in: [...componentServiceIds] } }
          ]
        }
      });
      for (const dependency of managed) {
        if (retainedDependencyIds.has(dependency.id)) continue;
        if (dependency.dependencyType === "HIERARCHY" && retainedModuleIds.has(dependency.fromServiceId)) continue;
        await tx.serviceDependency.update({
          where: { id: dependency.id },
          data: { isActive: false, updatedAt: now }
        });
        deactivatedCount += 1;
      }
    }

    const summary = `Imported ${manifest.modules.length} declared modules and ${componentCount} components from ${manifest.source}${deactivatedCount ? ` and deactivated ${deactivatedCount} removed links` : ""}.`;
    await tx.connection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: now,
        lastSyncStatus: "SUCCEEDED",
        lastSyncSummary: summary,
        lastSyncError: null,
        lastSyncImportedCount: manifest.modules.length,
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        updatedAt: now
      }
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        action: "CONNECTION_TOPOLOGY_RECONCILED",
        entityType: "CONNECTION",
        entityId: connection.id,
        metadataJson: {
          projectId: project.id,
          source: manifest.source,
          schemaVersion: manifest.schemaVersion,
          moduleKeys: manifest.modules.map((module) => module.key),
          componentKeys: components.map((component) => component.key),
          componentKinds: Object.fromEntries(components.map((component) => [component.key, component.kind])),
          relationships: relationships.map((relationship) => ({
            from: relationship.from,
            to: relationship.to,
            type: relationship.type,
            provenance: relationship.provenance
          })),
          healthBindings: healthBindings.map((binding) => ({
            componentKey: binding.componentKey,
            signal: binding.signal,
            lane: binding.lane ?? null,
            checkName: binding.checkName ?? null
          })),
          categories: Object.fromEntries(
            manifest.modules.map((module) => [module.key, module.category ?? null])
          ),
          routePrefixCounts: Object.fromEntries(
            manifest.modules.map((module) => [module.key, module.routePrefixes.length])
          ),
          deactivatedModuleLinks: deactivatedCount
        }
      }
    });
  });

  const canonical = await backfillCanonicalTopology({ projectId: project.id });
  const summary = `Imported ${manifest.modules.length} declared modules, ${componentCount} components and ${hierarchyCount} hierarchy links from ${manifest.source}.`;
  return {
    status: "SUCCEEDED",
    applicationId,
    moduleCount: manifest.modules.length,
    componentCount,
    relationshipCount,
    hierarchyCount,
    canonicalEntitiesMapped: canonical.entitiesMapped,
    canonicalRelationshipsMapped: canonical.relationshipsMapped,
    summary
  };
};

export const reconcileConnectionTopologyPayload = async (
  connection: ApiTopologyConnection,
  payload: unknown
): Promise<ConnectionTopologySyncResult> => {
  const manifest = parseConnectionTopologyManifest(payload);
  if (!manifest) {
    throw new Error("Discovery response does not contain an OpsWatch topology manifest");
  }
  return reconcileConnectionTopologyManifest(connection, manifest);
};

export const discoverAndReconcileConnectionTopology = async (
  connection: ApiTopologyConnection
): Promise<ConnectionTopologySyncResult> => {
  try {
    const payload = await fetchManifestPayload(connection);
    const result = await reconcileConnectionTopologyPayload(connection, payload);
    // Proposal refresh is separate from verified topology ingestion. It may
    // create applicability suggestions, never services, edges or owner choices.
    if (connection.projectId) {
      try {
        const manifest = parseConnectionTopologyManifest(payload);
        if (manifest) {
          const { refreshModuleProposalsAfterImport } = await import("../topology/module-discovery.service");
          await refreshModuleProposalsAfterImport(connection.organizationId, connection.projectId, manifest.modules.map(module => module.key));
        }
      } catch {
        console.warn("[module-discovery] Proposal refresh unavailable after successful topology import; retry from Modules.");
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topology discovery failed";
    await prisma.connection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: "FAILED",
        lastSyncError: message,
        updatedAt: new Date()
      }
    }).catch(() => undefined);
    throw error;
  }
};

const topologyConnectionSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  name: true,
  mode: true,
  environment: true,
  authMethod: true,
  configurationJson: true,
  credentialFamilyId: true,
  secretRef: true,
  managedSecretCiphertext: true,
  managedSecretIv: true,
  managedSecretAuthTag: true,
  syncIntervalMinutes: true,
  lastSyncAt: true
} as const;

export const discoverConnectionTopologyById = async (
  organizationId: string,
  connectionId: string
): Promise<ConnectionTopologySyncResult> => {
  const connection = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      organizationId,
      isActive: true
    },
    select: topologyConnectionSelect
  });
  if (!connection) throw new Error("Active connection not found");
  return discoverAndReconcileConnectionTopology(connection);
};

export const syncDueApiTopologyConnections = async (): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> => {
  const rows = await prisma.connection.findMany({
    where: {
      isActive: true,
      mode: "API",
      installationStatus: { in: ["CONNECTED", "DRAFT"] },
      projectId: { not: null }
    },
    select: topologyConnectionSelect,
    orderBy: { createdAt: "asc" }
  });
  const now = Date.now();
  const due = rows.filter((row) => {
    const config = isRecord(row.configurationJson) ? row.configurationJson : {};
    if (typeof config.discoveryPath !== "string" || !config.discoveryPath.trim()) return false;
    if (!row.lastSyncAt) return true;
    const interval = row.syncIntervalMinutes ?? 15;
    return now - row.lastSyncAt.getTime() >= interval * 60_000;
  });

  let succeeded = 0;
  let failed = 0;
  for (const connection of due) {
    try {
      await discoverAndReconcileConnectionTopology(connection);
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: due.length, succeeded, failed };
};
