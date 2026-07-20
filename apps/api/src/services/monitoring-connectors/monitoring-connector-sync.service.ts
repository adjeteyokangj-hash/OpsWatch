import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { canonicalGraph } from "../canonical-graph.service";
import { validateConnectionConfiguration } from "../connection-manifest.service";
import { createChangeLedgerEntry } from "../change-ledger.service";
import { resolveConnectionSecrets } from "../credentials/connection-credential.service";
import { MonitoringHttpError, monitoringHttpGetJson } from "./monitoring-connector-http.client";
import { parseMonitoringSyncPage } from "./monitoring-connector-normalize";
import { resolveMonitoringProfile } from "./monitoring-connector-profile.registry";
import {
  isMonitoringConnectorMode,
  MONITORING_ENTITY_SOURCE,
  MONITORING_SOURCE_PROVENANCE,
  type MonitoringConnectionRow,
  type MonitoringSyncResult
} from "./monitoring-connector-types";

const MONITORING_MODES = [
  "METRICS_ALERTS_CONNECTOR",
  "APPLICATION_PERFORMANCE_CONNECTOR",
  "INFRASTRUCTURE_MONITORING_CONNECTOR"
] as const;

export const listDueMonitoringConnections = async (): Promise<MonitoringConnectionRow[]> => {
  const rows = await prisma.connection.findMany({
    where: {
      isActive: true,
      mode: { in: [...MONITORING_MODES] },
      installationStatus: { in: ["CONNECTED", "DRAFT"] }
    },
    select: {
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
    }
  });
  const now = Date.now();
  return rows.filter((row) => {
    const intervalMinutes = row.syncIntervalMinutes ?? 15;
    if (!row.lastSyncAt) return true;
    return now - row.lastSyncAt.getTime() >= intervalMinutes * 60_000;
  });
};

const mapEntityType = (entityType: string): string => {
  switch (entityType) {
    case "MONITOR":
      return "MONITOR";
    case "PROBLEM":
      return "INCIDENT_SIGNAL";
    case "METRIC":
      return "METRIC";
    case "LOG_STREAM":
      return "LOG_SOURCE";
    case "TRACE_SERVICE":
      return "SERVICE";
    default:
      return "SERVICE";
  }
};

export const syncMonitoringConnection = async (
  connection: MonitoringConnectionRow
): Promise<MonitoringSyncResult> => {
  if (!isMonitoringConnectorMode(connection.mode)) {
    throw new Error("Connection is not a monitoring source connector");
  }
  if (!connection.projectId) {
    throw new Error("A project is required to synchronize monitoring source data");
  }

  const validated = validateConnectionConfiguration(connection.mode, connection.configurationJson);
  if (!validated.valid) {
    throw new Error(validated.error);
  }
  const configuration = validated.value;
  const baseUrl = String(configuration.baseUrl ?? configuration.endpoint ?? "").replace(/\/+$/, "");
  const profile = resolveMonitoringProfile(connection.mode, configuration);
  const syncPath = String(configuration.syncPath ?? profile.defaultSyncPath);
  const pageSize = Number(configuration.pageSize ?? profile.defaultPageSize);
  const cursorParam = String(configuration.cursorParam ?? profile.cursorParam);
  const secrets = (await resolveConnectionSecrets(connection)).map((entry) => entry.plaintext);
  const secret = secrets[0] ?? null;

  const runId = randomUUID();
  const startedAt = Date.now();
  await prisma.monitoringSyncRun.create({
    data: {
      id: runId,
      organizationId: connection.organizationId,
      connectionId: connection.id,
      projectId: connection.projectId,
      environment: connection.environment ?? "production",
      connectorMode: connection.mode,
      status: "RUNNING",
      startedAt: new Date(startedAt),
      updatedAt: new Date()
    }
  });

  let importedCount = 0;
  let pageCount = 0;
  let entityCount = 0;
  let signalCount = 0;
  let cursor: string | null = null;
  let cursorEnd: string | null = null;
  const limitations = [...profile.limitations];

  try {
    do {
      const page = await monitoringHttpGetJson<unknown>({
        baseUrl,
        path: syncPath,
        authMethod: connection.authMethod,
        secret,
        configuration,
        query: {
          [cursorParam]: cursor ?? undefined,
          [profile.pageSizeParam]: pageSize
        }
      });
      const parsed = parseMonitoringSyncPage(connection.mode, page.data, cursorParam);
      pageCount += 1;
      const batch = parsed.items[0];
      if (!batch) break;

      for (const entity of batch.entities) {
        await canonicalGraph.upsertEntity({
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          environment: connection.environment ?? "production",
          entityType: mapEntityType(entity.entityType),
          stableKey: entity.stableKey,
          name: entity.name,
          source: MONITORING_ENTITY_SOURCE,
          provenance: MONITORING_SOURCE_PROVENANCE,
          health: entity.health ?? "UNKNOWN",
          metadata: {
            connectorMode: connection.mode,
            connectionId: connection.id,
            importedAt: new Date().toISOString(),
            ...(entity.metadata ?? {})
          },
          incrementEvidence: true
        });
        entityCount += 1;
        importedCount += 1;
      }

      for (const signal of batch.signals) {
        signalCount += 1;
        importedCount += 1;
        await createChangeLedgerEntry({
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          connectionId: connection.id,
          kind: "CHANGE",
          summary: `${connection.name}: ${signal.title}`,
          source: MONITORING_SOURCE_PROVENANCE,
          externalId: signal.externalId,
          evidence: {
            signalKind: signal.kind,
            connectorMode: connection.mode,
            severity: signal.severity ?? null,
            entityStableKey: signal.entityStableKey ?? null,
            observedAt: signal.observedAt ?? null,
            metadata: signal.metadata ?? null
          }
        });
      }

      cursor = parsed.nextCursor;
      cursorEnd = parsed.nextCursor;
      if (!parsed.hasMore) break;
      if (pageCount >= 50) {
        limitations.push("Sync stopped after 50 pages to protect runtime budgets.");
        break;
      }
    } while (cursor);

    const durationMs = Date.now() - startedAt;
    const summary = `Imported ${entityCount} entities and ${signalCount} signals across ${pageCount} page(s).`;
    const status = limitations.some((item) => item.includes("stopped")) ? "PARTIAL" : "SUCCEEDED";

    await prisma.$transaction([
      prisma.monitoringSyncRun.update({
        where: { id: runId },
        data: {
          status,
          completedAt: new Date(),
          durationMs,
          importedCount,
          pageCount,
          cursorStart: null,
          cursorEnd,
          summaryJson: { entityCount, signalCount },
          limitationsJson: limitations,
          updatedAt: new Date()
        }
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: status,
          lastSyncSummary: summary,
          lastSyncError: null,
          lastSyncDurationMs: durationMs,
          lastSyncImportedCount: importedCount,
          lastSyncCursor: cursorEnd,
          health: "HEALTHY",
          healthReason: null,
          installationStatus: "CONNECTED",
          updatedAt: new Date()
        }
      })
    ]);

    return {
      status,
      importedCount,
      pageCount,
      durationMs,
      cursorEnd,
      summary,
      limitations,
      entities: entityCount,
      signals: signalCount,
      relationships: 0
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const category = error instanceof MonitoringHttpError ? error.category : "INVALID_RESPONSE";
    const message = error instanceof Error ? error.message : "Monitoring sync failed";
    await prisma.$transaction([
      prisma.monitoringSyncRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          durationMs,
          importedCount,
          pageCount,
          errorCategory: category,
          errorMessage: message,
          limitationsJson: limitations,
          updatedAt: new Date()
        }
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: "FAILED",
          lastSyncSummary: null,
          lastSyncError: message,
          lastSyncDurationMs: durationMs,
          lastSyncImportedCount: importedCount,
          health: "DEGRADED",
          healthReason: "Monitoring source sync failed",
          updatedAt: new Date()
        }
      })
    ]);
    return {
      status: "FAILED",
      importedCount,
      pageCount,
      durationMs,
      cursorEnd,
      summary: "Monitoring source sync failed",
      error: message,
      errorCategory: category,
      limitations,
      entities: entityCount,
      signals: signalCount,
      relationships: 0
    };
  }
};

export const syncDueMonitoringConnections = async (): Promise<{ attempted: number; succeeded: number }> => {
  const due = await listDueMonitoringConnections();
  let succeeded = 0;
  for (const connection of due) {
    const result = await syncMonitoringConnection(connection);
    if (result.status === "SUCCEEDED" || result.status === "PARTIAL") succeeded += 1;
  }
  return { attempted: due.length, succeeded };
};

export const syncMonitoringConnectionById = async (
  organizationId: string,
  connectionId: string
): Promise<MonitoringSyncResult> => {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, organizationId, isActive: true },
    select: {
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
    }
  });
  if (!connection) throw new Error("Monitoring connection not found");
  return syncMonitoringConnection(connection);
};
