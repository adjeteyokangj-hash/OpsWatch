import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import {
  isDisallowedNetworkAddress,
  parseSafeExternalHttpUrl
} from "@opswatch/shared";
import { prisma } from "../lib/prisma";
import {
  isConnectionMode,
  joinConnectionUrl,
  validateConnectionConfiguration
} from "./connection-manifest.service";
import {
  createChangeLedgerEntry,
  type ChangeLedgerKind
} from "./change-ledger.service";
import {
  recordConnectionCredentialProbe,
  resolveConnectionSecret,
  resolveConnectionSecrets,
  sanitizeConnectionError
} from "./credentials/connection-credential.service";
import { isMonitoringConnectorMode } from "./monitoring-connectors/monitoring-connector-types";
import { testMonitoringConnection } from "./monitoring-connectors/monitoring-connector-test.service";

type ConnectionRow = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  mode: string;
  environment?: string | null;
  authMethod?: string;
  configurationJson: unknown;
  credentialFamilyId?: string | null;
  secretRef: string | null;
  managedSecretCiphertext?: string | null;
  managedSecretIv?: string | null;
  managedSecretAuthTag?: string | null;
  linkedServiceId?: string | null;
  linkedCheckId?: string | null;
};

export type ConnectionErrorCategory =
  | "DNS_FAILED" | "TIMEOUT" | "TLS_FAILED" | "AUTHENTICATION_FAILED"
  | "FORBIDDEN" | "ENDPOINT_NOT_FOUND" | "INVALID_RESPONSE" | "SERVER_ERROR"
  | "DISCOVERY_FAILED";

export type ProbeResult = {
  succeeded: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  error?: string;
  errorCategory?: ConnectionErrorCategory;
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
  const sanitizedError = sanitizeConnectionError(
    result.error,
    (await resolveConnectionSecrets(connection)).map((entry) => entry.plaintext)
  );
  await prisma.connection.update({
    where: { id: connection.id },
    data: result.succeeded
      ? {
        health: "HEALTHY",
        healthReason: null,
        lastSuccessAt: now,
        lastError: null,
        lastValidatedAt: now,
        validationStatusCode: result.statusCode ?? null,
        validationLatencyMs: result.responseTimeMs ?? null,
        validationErrorCategory: null,
        installationStatus: "CONNECTED",
        updatedAt: now
      }
      : {
        health: "DEGRADED",
        healthReason: "Agentless probe failed",
        lastFailureAt: now,
        lastError: sanitizedError ?? "Agentless probe failed",
        lastValidatedAt: now,
        validationStatusCode: result.statusCode ?? null,
        validationLatencyMs: result.responseTimeMs ?? null,
        validationErrorCategory: result.errorCategory ?? "INVALID_RESPONSE",
        installationStatus: "ERROR",
        updatedAt: now
      }
  });
  await recordConnectionCredentialProbe(connection, { succeeded: result.succeeded });
  await recordAudit(connection, "CONNECTION_PROBE", {
    succeeded: result.succeeded,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs ?? null,
    error: sanitizedError ?? null,
    errorCategory: result.errorCategory ?? null
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
      error: sanitizedError ?? null,
      errorCategory: result.errorCategory ?? null
    }
  });
};

export const assertSafeConnectionTarget = async (target: string): Promise<void> => {
  if (process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES === "true") {
    try {
      const localUrl = new URL(target.trim());
      if (
        localUrl.hostname === "127.0.0.1" ||
        localUrl.hostname === "localhost" ||
        localUrl.hostname === "::1"
      ) {
        return;
      }
    } catch {
      // fall through to strict validation
    }
  }
  const url = parseSafeExternalHttpUrl(target);
  if (process.env.NODE_ENV === "test" && url.hostname.endsWith(".test")) return;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isDisallowedNetworkAddress(address))) {
    throw new Error("Private or unresolved network targets are not allowed");
  }
};

export const buildConnectionHeaders = (
  authMethod: string,
  secret: string | null,
  configuration: Record<string, unknown>
): Record<string, string> => {
  if (authMethod === "NONE") return {};
  if (!secret) throw new Error("A credential is required for the selected authentication method");
  const headerName = typeof configuration.authHeaderName === "string" ? configuration.authHeaderName : undefined;
  const prefix = typeof configuration.authPrefix === "string" ? configuration.authPrefix.trim() : undefined;
  switch (authMethod) {
    case "BEARER": return { Authorization: `${prefix || "Bearer"} ${secret}` };
    case "BASIC": return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
    case "API_KEY": return { [headerName || "X-API-Key"]: prefix ? `${prefix} ${secret}` : secret };
    case "CUSTOM_HEADER":
      if (!headerName || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName)) throw new Error("A valid authHeaderName is required");
      return { [headerName]: prefix ? `${prefix} ${secret}` : secret };
    default: throw new Error("Unsupported authentication method");
  }
};

const httpFailure = (status: number): ConnectionErrorCategory | undefined => {
  if (status === 401) return "AUTHENTICATION_FAILED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "ENDPOINT_NOT_FOUND";
  if (status >= 500) return "SERVER_ERROR";
  if (status >= 400) return "INVALID_RESPONSE";
  return undefined;
};

const classifyFetchError = (error: unknown): ConnectionErrorCategory => {
  const code = String((error as any)?.cause?.code ?? (error as any)?.code ?? "");
  const message = error instanceof Error ? error.message : "";
  if ((error as any)?.name === "AbortError" || /abort|timeout/i.test(message)) return "TIMEOUT";
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(code + message)) return "DNS_FAILED";
  if (/CERT|TLS|SSL|EPROTO/i.test(code + message)) return "TLS_FAILED";
  return "INVALID_RESPONSE";
};

const probe = async (connection: ConnectionRow, overrideSecret?: string): Promise<ProbeResult> => {
  if (isMonitoringConnectorMode(connection.mode)) {
    const monitoringResult = await testMonitoringConnection({
      ...connection,
      environment: connection.environment ?? "production",
      authMethod: connection.authMethod ?? "NONE"
    }, { authSecret: overrideSecret });
    return {
      succeeded: monitoringResult.succeeded,
      statusCode: monitoringResult.statusCode,
      responseTimeMs: monitoringResult.responseTimeMs,
      ...(monitoringResult.succeeded ? {} : {
        error: monitoringResult.error,
        errorCategory: monitoringResult.errorCategory as ConnectionErrorCategory | undefined
      })
    };
  }
  if (!isConnectionMode(connection.mode) || !["AGENTLESS", "API"].includes(connection.mode)) {
    return { succeeded: false, error: "This connector does not implement an agentless probe", errorCategory: "INVALID_RESPONSE" };
  }
  const validated = validateConnectionConfiguration(connection.mode, connection.configurationJson);
  if (!validated.valid) return { succeeded: false, error: validated.error, errorCategory: "INVALID_RESPONSE" };

  const controller = new AbortController();
  const timeoutMs = typeof validated.value.timeoutMs === "number" ? validated.value.timeoutMs : 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const resolvedSecrets = overrideSecret
    ? [overrideSecret]
    : (await resolveConnectionSecrets(connection)).map((entry) => entry.plaintext);
  try {
    const endpoint = String(validated.value.endpoint);
    await assertSafeConnectionTarget(endpoint);
    const secret = overrideSecret ?? resolvedSecrets[0] ?? null;
    const headers = buildConnectionHeaders(connection.authMethod ?? "NONE", secret, validated.value);
    const response = await fetch(endpoint, {
      method: String(validated.value.method ?? "GET").toUpperCase(),
      headers,
      signal: controller.signal,
      redirect: "manual"
    });
    const category = httpFailure(response.status);
    const rawError = response.ok ? undefined : `Endpoint returned HTTP ${response.status}`;
    return {
      succeeded: response.ok,
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      ...(response.ok ? {} : {
        error: sanitizeConnectionError(rawError, resolvedSecrets),
        errorCategory: category
      })
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : "Probe failed";
    return {
      succeeded: false,
      responseTimeMs: Date.now() - startedAt,
      error: sanitizeConnectionError(rawError, resolvedSecrets),
      errorCategory: classifyFetchError(error)
    };
  } finally {
    clearTimeout(timer);
  }
};

const provisionMonitoring = async (connection: ConnectionRow, expectedStatusCode: number): Promise<void> => {
  if (!connection.projectId) throw new Error("A project is required to start monitoring");
  const validated = validateConnectionConfiguration(connection.mode as any, connection.configurationJson);
  if (!validated.valid) throw new Error(validated.error);
  const target = String(validated.value.endpoint);
  const timeoutMs = Number(validated.value.timeoutMs ?? 10_000);
  await prisma.$transaction(async (tx) => {
    let serviceId = connection.linkedServiceId;
    if (serviceId) {
      const service = await tx.service.findFirst({ where: { id: serviceId, projectId: connection.projectId! }, select: { id: true } });
      if (!service) serviceId = null;
    }
    if (!serviceId) {
      const service = await tx.service.create({
        data: { id: randomUUID(), projectId: connection.projectId!, name: connection.name, type: "API", baseUrl: target, updatedAt: new Date() }
      });
      serviceId = service.id;
    } else {
      await tx.service.update({ where: { id: serviceId }, data: { baseUrl: target, updatedAt: new Date() } });
    }
    let checkId = connection.linkedCheckId;
    if (checkId) {
      const check = await tx.check.findFirst({ where: { id: checkId, serviceId }, select: { id: true } });
      if (!check) checkId = null;
    }
    if (!checkId) {
      const check = await tx.check.create({
        data: {
          id: randomUUID(), serviceId, name: `${connection.name} health`, type: "HTTP",
          intervalSeconds: 60, timeoutMs, expectedStatusCode, isActive: true,
          configJson: { source: "CONNECTION", connectionId: connection.id }, updatedAt: new Date()
        }
      });
      checkId = check.id;
    } else {
      await tx.check.update({ where: { id: checkId }, data: { timeoutMs, expectedStatusCode, isActive: true, updatedAt: new Date() } });
    }
    await tx.connection.update({ where: { id: connection.id }, data: { linkedServiceId: serviceId, linkedCheckId: checkId } });
  });
};

export const testUnsavedConnection = async (
  input: Omit<ConnectionRow, "id" | "organizationId" | "projectId" | "name" | "secretRef"> & { authSecret?: string }
): Promise<ProbeResult> => probe({
  id: "unsaved", organizationId: "unsaved", projectId: null, name: "Unsaved connection",
  secretRef: null, ...input
}, input.authSecret);

export const testAgentlessConnection = async (
  connection: ConnectionRow,
  options: { startMonitoring?: boolean } = {}
): Promise<ProbeResult> => {
  const result = await probe(connection);
  if (connection.id !== "unsaved") {
    await recordProbeResult(connection, result);
  }
  if (result.succeeded && options.startMonitoring) await provisionMonitoring(connection, result.statusCode ?? 200);
  return result;
};

export const discoverApiConnection = async (connection: ConnectionRow) => {
  if (connection.mode !== "API") throw new Error("Discovery is implemented for generic API connections only");
  const validated = validateConnectionConfiguration("API", connection.configurationJson);
  if (!validated.valid) throw new Error(validated.error);
  const discoveryPath = validated.value.discoveryPath;
  if (typeof discoveryPath !== "string") throw new Error("Configure discoveryPath before running discovery");

  const endpoint = new URL(String(validated.value.endpoint));
  const discoveryUrl = new URL(joinConnectionUrl(endpoint.origin, discoveryPath));
  if (discoveryUrl.origin !== endpoint.origin) throw new Error("discoveryPath must stay on the configured endpoint origin");
  await assertSafeConnectionTarget(discoveryUrl.toString());
  const secret = await resolveConnectionSecret(connection);
  const headers = buildConnectionHeaders(connection.authMethod ?? "NONE", secret, validated.value);
  const response = await fetch(discoveryUrl, { method: "GET", headers, redirect: "manual" });
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
