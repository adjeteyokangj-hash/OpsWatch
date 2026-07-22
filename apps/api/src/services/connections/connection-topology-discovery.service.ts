import { createHash, randomUUID } from "crypto";
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
  description: string;
  criticality: "HIGH" | "MEDIUM";
  routePrefixes: string[];
};

export type ConnectionTopologyManifest = {
  schemaVersion: "1.0";
  source: string;
  application: {
    key: string;
    name: string;
  };
  modules: DeclaredModuleManifest[];
};

export type ConnectionTopologySyncResult = {
  status: "SUCCEEDED" | "SKIPPED";
  applicationId: string;
  moduleCount: number;
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

export const parseConnectionTopologyManifest = (
  payload: unknown
): ConnectionTopologyManifest | null => {
  const candidate = manifestCandidate(payload);
  if (candidate == null) return null;
  if (!isRecord(candidate)) throw new Error("opswatchTopology must be an object");
  if (candidate.schemaVersion !== "1.0") {
    throw new Error("Unsupported OpsWatch topology schema version");
  }
  if (!isRecord(candidate.application)) {
    throw new Error("opswatchTopology.application must be an object");
  }
  if (!Array.isArray(candidate.modules)) {
    throw new Error("opswatchTopology.modules must be an array");
  }
  if (candidate.modules.length > 100) {
    throw new Error("opswatchTopology.modules exceeds the 100 module safety limit");
  }

  const seenKeys = new Set<string>();
  const modules = candidate.modules.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`modules[${index}] must be an object`);
    const key = readKey(raw.key, `modules[${index}].key`);
    if (seenKeys.has(key)) throw new Error(`Duplicate module key: ${key}`);
    seenKeys.add(key);
    const criticality = String(raw.criticality ?? "MEDIUM").toUpperCase();
    if (criticality !== "HIGH" && criticality !== "MEDIUM") {
      throw new Error(`modules[${index}].criticality must be HIGH or MEDIUM`);
    }
    return {
      key,
      name: readRequiredString(raw.name, `modules[${index}].name`, 120),
      description:
        typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : "",
      criticality,
      routePrefixes: readRoutePrefixes(raw.routePrefixes)
    } as DeclaredModuleManifest;
  });

  return {
    schemaVersion: "1.0",
    source: readRequiredString(candidate.source, "opswatchTopology.source", 80),
    application: {
      key: readKey(candidate.application.key, "opswatchTopology.application.key"),
      name: readRequiredString(candidate.application.name, "opswatchTopology.application.name", 120)
    },
    modules
  };
};

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

  await prisma.$transaction(async (tx) => {
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
            updatedAt: now
          }
        });
    applicationId = app.id;

    for (const module of manifest.modules) {
      const deterministicModuleId = stableId("svc-mod", connection.id, module.key);
      const existingModule = await tx.service.findFirst({
        where: {
          projectId: project.id,
          type: "MODULE",
          OR: [{ id: deterministicModuleId }, { name: module.name }]
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
              updatedAt: now
            }
          });

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

    const summary = `Imported ${manifest.modules.length} declared modules from ${manifest.source}.`;
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
          routePrefixCounts: Object.fromEntries(
            manifest.modules.map((module) => [module.key, module.routePrefixes.length])
          ),
          deletionPolicy: "ADDITIVE_ONLY"
        }
      }
    });
  });

  const canonical = await backfillCanonicalTopology({ projectId: project.id });
  const summary = `Imported ${manifest.modules.length} declared modules and ${hierarchyCount} hierarchy links from ${manifest.source}.`;
  return {
    status: "SUCCEEDED",
    applicationId,
    moduleCount: manifest.modules.length,
    hierarchyCount,
    canonicalEntitiesMapped: canonical.entitiesMapped,
    canonicalRelationshipsMapped: canonical.relationshipsMapped,
    summary
  };
};

export const discoverAndReconcileConnectionTopology = async (
  connection: ApiTopologyConnection
): Promise<ConnectionTopologySyncResult> => {
  try {
    const payload = await fetchManifestPayload(connection);
    const manifest = parseConnectionTopologyManifest(payload);
    if (!manifest) {
      throw new Error("Discovery response does not contain an OpsWatch topology manifest");
    }
    return await reconcileConnectionTopologyManifest(connection, manifest);
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
