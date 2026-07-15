import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import {
  isConnectionMode,
  validateConnectionConfiguration
} from "./connection-manifest.service";
import {
  createChangeLedgerEntry,
  type ChangeLedgerKind
} from "./change-ledger.service";

type ConnectionRow = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  mode: string;
  configurationJson: unknown;
  secretRef: string | null;
};

type ProbeResult = {
  succeeded: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  error?: string;
};

const recordAudit = async (
  connection: ConnectionRow,
  action: string,
  metadata: Record<string, unknown>
) => prisma.auditLog.create({
  data: {
    id: randomUUID(),
    action,
    entityType: "CONNECTION",
    entityId: connection.id,
    metadataJson: { organizationId: connection.organizationId, ...metadata }
  }
});

const recordProbeResult = async (connection: ConnectionRow, result: ProbeResult) => {
  const now = new Date();
  await prisma.connection.update({
    where: { id: connection.id },
    data: result.succeeded
      ? {
        health: "HEALTHY",
        healthReason: null,
        lastSuccessAt: now,
        lastError: null,
        installationStatus: "ACTIVE",
        updatedAt: now
      }
      : {
        health: "DEGRADED",
        healthReason: "Agentless probe failed",
        lastFailureAt: now,
        lastError: result.error ?? "Agentless probe failed",
        installationStatus: "ERROR",
        updatedAt: now
      }
  });
  await recordAudit(connection, "CONNECTION_PROBE", {
    succeeded: result.succeeded,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs ?? null,
    error: result.error ?? null
  });
  await createChangeLedgerEntry({
    organizationId: connection.organizationId,
    projectId: connection.projectId,
    connectionId: connection.id,
    kind: "CONNECTION_VALIDATION",
    summary: `${connection.name} ${result.succeeded ? "passed" : "failed"} an agentless probe`,
    source: "AGENTLESS_PROBE",
    evidence: {
      statusCode: result.statusCode ?? null,
      responseTimeMs: result.responseTimeMs ?? null,
      error: result.error ?? null
    }
  });
};

const probe = async (connection: ConnectionRow): Promise<ProbeResult> => {
  if (!isConnectionMode(connection.mode) || !["AGENTLESS", "API"].includes(connection.mode)) {
    return { succeeded: false, error: "This connector does not implement an agentless probe" };
  }
  const validated = validateConnectionConfiguration(connection.mode, connection.configurationJson);
  if (!validated.valid) return { succeeded: false, error: validated.error };

  const controller = new AbortController();
  const timeoutMs = typeof validated.value.timeoutMs === "number" ? validated.value.timeoutMs : 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(String(validated.value.endpoint), {
      method: String(validated.value.method ?? "GET").toUpperCase(),
      signal: controller.signal,
      redirect: "manual"
    });
    return {
      succeeded: response.ok,
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      ...(response.ok ? {} : { error: `Endpoint returned HTTP ${response.status}` })
    };
  } catch (error) {
    return { succeeded: false, responseTimeMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Probe failed" };
  } finally {
    clearTimeout(timer);
  }
};

export const testAgentlessConnection = async (connection: ConnectionRow): Promise<ProbeResult> => {
  const result = await probe(connection);
  await recordProbeResult(connection, result);
  return result;
};

export const discoverApiConnection = async (connection: ConnectionRow) => {
  if (connection.mode !== "API") throw new Error("Discovery is implemented for generic API connections only");
  const validated = validateConnectionConfiguration("API", connection.configurationJson);
  if (!validated.valid) throw new Error(validated.error);
  const discoveryPath = validated.value.discoveryPath;
  if (typeof discoveryPath !== "string") throw new Error("Configure discoveryPath before running discovery");

  const endpoint = new URL(String(validated.value.endpoint));
  const discoveryUrl = new URL(discoveryPath, endpoint);
  if (discoveryUrl.origin !== endpoint.origin) throw new Error("discoveryPath must stay on the configured endpoint origin");
  const response = await fetch(discoveryUrl, { method: "GET" });
  if (!response.ok) throw new Error(`Discovery endpoint returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const objectKeys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>).slice(0, 100)
    : [];
  await recordAudit(connection, "CONNECTION_DISCOVERY", {
    endpoint: discoveryUrl.toString(),
    statusCode: response.status,
    objectKeys
  });
  return { endpoint: discoveryUrl.toString(), statusCode: response.status, objectKeys };
};

export const resolveConnectionSecretReference = (reference: string | null): string | null => {
  if (!reference?.startsWith("env://")) return null;
  const name = reference.slice("env://".length);
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return null;
  return process.env[name] ?? null;
};

export const recordSignedConnectionEvent = async (
  connection: ConnectionRow,
  input: {
    kind: ChangeLedgerKind;
    summary: string;
    externalId?: string;
    actor?: string;
    evidence?: Record<string, unknown>;
    occurredAt?: Date;
  }
) => {
  const row = await createChangeLedgerEntry({
    organizationId: connection.organizationId,
    projectId: connection.projectId,
    connectionId: connection.id,
    kind: input.kind,
    summary: input.summary,
    actorType: input.actor ? "WEBHOOK" : null,
    actor: input.actor ?? null,
    source: "SIGNED_WEBHOOK",
    externalId: input.externalId ?? null,
    evidence: input.evidence ?? null,
    occurredAt: input.occurredAt
  });
  if (input.kind === "DEPLOYMENT") {
    const evidence = input.evidence ?? {};
    await prisma.deploymentRecord.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        projectId: connection.projectId,
        deployedAt: input.occurredAt ?? new Date(),
        version: typeof evidence.version === "string" ? evidence.version : null,
        commitSha: typeof evidence.commitSha === "string" ? evidence.commitSha : null,
        branch: typeof evidence.branch === "string" ? evidence.branch : null,
        source: "SIGNED_WEBHOOK",
        summary: input.summary,
        detailsJson: evidence as any
      }
    });
  }
  await recordAudit(connection, "CONNECTION_EVENT_INGESTED", {
    ledgerEntryId: row.id,
    kind: input.kind,
    externalId: input.externalId ?? null
  });
  return row;
};
