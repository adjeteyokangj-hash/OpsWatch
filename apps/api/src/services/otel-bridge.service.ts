import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const SENSITIVE_ATTRIBUTE = /(authorization|cookie|password|secret|token|api.?key|credential|session|jwt|email|phone|address)/i;
const RESOURCE_ATTRIBUTE_ALLOWLIST = new Set([
  "service.name", "service.version", "service.namespace", "deployment.environment",
  "host.name", "host.id", "container.id", "container.name", "k8s.cluster.name",
  "k8s.namespace.name", "k8s.pod.name", "cloud.provider", "cloud.region"
]);
const SIGNAL_ATTRIBUTE_ALLOWLIST = /^(http\.(request|response|route|method|status_code)|rpc\.(system|service|method)|db\.system|messaging\.(system|operation|destination\.name)|error\.type|otel\.status_code|server\.address|server\.port|url\.scheme)$/;
const MAX_ATTRIBUTE_COUNT = 32;
const MAX_ATTRIBUTE_VALUE_LENGTH = 512;
const MAX_SIGNALS = 1_000;

export type OtelSignalKind = "METRIC" | "LOG" | "SPAN";

export type OtelBridgePayload = {
  resource: {
    serviceName: string;
    serviceVersion?: string;
    deploymentEnvironment?: string;
    hostName?: string;
    containerId?: string;
    attributes?: Record<string, unknown>;
  };
  signals: Array<{
    kind: OtelSignalKind;
    name: string;
    timestamp?: string;
    severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    value?: number;
    body?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    attributes?: Record<string, unknown>;
  }>;
};

export type OtelConnection = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const truncate = (value: string): string => value.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);

const sanitizeAttributeValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
};

export const redactOtelAttributes = (
  attributes: Record<string, unknown> | undefined,
  allowed: (key: string) => boolean
): Record<string, string | number | boolean | null> => {
  if (!attributes) return {};
  return Object.entries(attributes)
    .filter(([key]) => !SENSITIVE_ATTRIBUTE.test(key) && allowed(key))
    .slice(0, MAX_ATTRIBUTE_COUNT)
    .reduce<Record<string, string | number | boolean | null>>((result, [key, value]) => {
      result[key] = sanitizeAttributeValue(value);
      return result;
    }, {});
};

export const isOtelIngestionEnabled = (): boolean => process.env.OPSWATCH_OTEL_INGESTION_ENABLED === "true";

export const otelPayloadLimitBytes = (): number => {
  const configured = Number(process.env.OPSWATCH_OTEL_MAX_PAYLOAD_BYTES ?? 524_288);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 1_048_576) : 524_288;
};

const otlpAttributeMap = (value: unknown): Record<string, unknown> => {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<string, unknown>>((attributes, row) => {
    const entry = asObject(row);
    const key = typeof entry?.key === "string" ? entry.key : null;
    const typed = asObject(entry?.value);
    if (!key || !typed) return attributes;
    const next = typed.stringValue ?? typed.boolValue ?? typed.intValue ?? typed.doubleValue;
    if (typeof next === "string" || typeof next === "boolean" || typeof next === "number") attributes[key] = next;
    return attributes;
  }, {});
};

const otlpTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(BigInt(value) / 1_000_000n);
  const parsed = new Date(milliseconds);
  return Number.isFinite(milliseconds) && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
};

const fromOtlpHttpJson = (body: Record<string, unknown>): OtelBridgePayload | null => {
  const groups = [
    ...(Array.isArray(body.resourceMetrics) ? body.resourceMetrics.map((value) => ["METRIC", value] as const) : []),
    ...(Array.isArray(body.resourceLogs) ? body.resourceLogs.map((value) => ["LOG", value] as const) : []),
    ...(Array.isArray(body.resourceSpans) ? body.resourceSpans.map((value) => ["SPAN", value] as const) : [])
  ];
  if (groups.length === 0) return null;
  const first = asObject(groups[0]?.[1]);
  const rawResource = asObject(first?.resource);
  const resourceAttributes = otlpAttributeMap(rawResource?.attributes);
  const serviceName = typeof resourceAttributes["service.name"] === "string" ? resourceAttributes["service.name"] : "";
  if (!serviceName) return null;
  const signals: OtelBridgePayload["signals"] = [];
  for (const [kind, rawGroup] of groups) {
    const group = asObject(rawGroup);
    const scopes = group?.[kind === "METRIC" ? "scopeMetrics" : kind === "LOG" ? "scopeLogs" : "scopeSpans"];
    if (!Array.isArray(scopes)) continue;
    for (const rawScope of scopes) {
      const scope = asObject(rawScope);
      if (kind === "METRIC" && Array.isArray(scope?.metrics)) {
        for (const rawMetric of scope.metrics) {
          const metric = asObject(rawMetric);
          const name = typeof metric?.name === "string" ? metric.name : "";
          const pointSet = asObject(metric?.gauge) ?? asObject(metric?.sum) ?? asObject(metric?.histogram);
          const point = Array.isArray(pointSet?.dataPoints) ? asObject(pointSet.dataPoints[0]) : null;
          if (!name || !point) continue;
          const rawValue = point.asDouble ?? point.asInt ?? point.count;
          signals.push({ kind, name, ...(typeof rawValue === "number" ? { value: rawValue } : {}), attributes: otlpAttributeMap(point.attributes), ...(otlpTimestamp(point.timeUnixNano) ? { timestamp: otlpTimestamp(point.timeUnixNano) } : {}) });
        }
      } else if (kind === "LOG" && Array.isArray(scope?.logRecords)) {
        for (const rawLog of scope.logRecords) {
          const log = asObject(rawLog);
          const bodyValue = asObject(log?.body)?.stringValue;
          const severityText = typeof log?.severityText === "string" ? log.severityText.toUpperCase() : "";
          signals.push({
            kind, name: typeof log?.eventName === "string" ? log.eventName : "log",
            ...(typeof bodyValue === "string" ? { body: bodyValue } : {}),
            ...(severityText.includes("ERROR") || severityText.includes("FATAL") ? { severity: "HIGH" } : { severity: "INFO" }),
            attributes: otlpAttributeMap(log?.attributes),
            ...(otlpTimestamp(log?.timeUnixNano) ? { timestamp: otlpTimestamp(log?.timeUnixNano) } : {})
          });
        }
      } else if (kind === "SPAN" && Array.isArray(scope?.spans)) {
        for (const rawSpan of scope.spans) {
          const span = asObject(rawSpan);
          const statusCode = asObject(span?.status)?.code;
          signals.push({
            kind, name: typeof span?.name === "string" ? span.name : "span",
            ...(typeof span?.traceId === "string" ? { traceId: span.traceId } : {}),
            ...(typeof span?.spanId === "string" ? { spanId: span.spanId } : {}),
            ...(typeof span?.parentSpanId === "string" ? { parentSpanId: span.parentSpanId } : {}),
            ...(statusCode === 2 || statusCode === "STATUS_CODE_ERROR" ? { severity: "HIGH" } : { severity: "INFO" }),
            attributes: otlpAttributeMap(span?.attributes),
            ...(otlpTimestamp(span?.endTimeUnixNano ?? span?.startTimeUnixNano) ? { timestamp: otlpTimestamp(span?.endTimeUnixNano ?? span?.startTimeUnixNano) } : {})
          });
        }
      }
    }
  }
  return {
    resource: {
      serviceName,
      ...(typeof resourceAttributes["service.version"] === "string" ? { serviceVersion: resourceAttributes["service.version"] } : {}),
      ...(typeof resourceAttributes["deployment.environment"] === "string" ? { deploymentEnvironment: resourceAttributes["deployment.environment"] } : {}),
      ...(typeof resourceAttributes["host.name"] === "string" ? { hostName: resourceAttributes["host.name"] } : {}),
      ...(typeof resourceAttributes["container.id"] === "string" ? { containerId: resourceAttributes["container.id"] } : {}),
      attributes: resourceAttributes
    },
    signals
  };
};

export const parseOtelBridgePayload = (input: unknown): { value?: OtelBridgePayload; error?: string } => {
  const body = asObject(input);
  if (!body) return { error: "Telemetry body must be an object" };
  const otlpPayload = fromOtlpHttpJson(body);
  if (otlpPayload) return parseOtelBridgePayload(otlpPayload);
  const resource = asObject(body?.resource);
  const signals = Array.isArray(body?.signals) ? body.signals : null;
  const serviceName = typeof resource?.serviceName === "string" ? resource.serviceName.trim() : "";
  if (!resource || !serviceName || serviceName.length > 200) return { error: "resource.serviceName is required and must be at most 200 characters" };
  if (!signals || signals.length === 0 || signals.length > MAX_SIGNALS) return { error: `signals must contain between 1 and ${MAX_SIGNALS} records` };

  const parsedSignals: OtelBridgePayload["signals"] = [];
  for (const signal of signals) {
    const row = asObject(signal);

    if (!row) {
      return { error: "each signal must be an object" };
    }

    const kind = typeof row.kind === "string" ? row.kind.toUpperCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";

    if (!["METRIC", "LOG", "SPAN"].includes(kind) || !name || name.length > 300) {
      return { error: "each signal requires kind METRIC, LOG, or SPAN and a name of at most 300 characters" };
    }

    const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;

    if (timestamp && Number.isNaN(Date.parse(timestamp))) {
      return { error: "signal.timestamp must be an ISO date when provided" };
    }

    if (
      row.value !== undefined &&
      (typeof row.value !== "number" || !Number.isFinite(row.value))
    ) {
      return { error: "signal.value must be a finite number when provided" };
    }

    parsedSignals.push({
      kind: kind as OtelSignalKind,
      name,
      ...(timestamp ? { timestamp } : {}),
      ...(typeof row.severity === "string" && ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(row.severity.toUpperCase())
        ? { severity: row.severity.toUpperCase() as OtelBridgePayload["signals"][number]["severity"] } : {}),
      ...(typeof row.value === "number" ? { value: row.value } : {}),
      ...(typeof row.body === "string" ? { body: truncate(row.body) } : {}),
      ...(typeof row.traceId === "string" ? { traceId: truncate(row.traceId) } : {}),
      ...(typeof row.spanId === "string" ? { spanId: truncate(row.spanId) } : {}),
      ...(typeof row.parentSpanId === "string" ? { parentSpanId: truncate(row.parentSpanId) } : {}),
      ...(asObject(row.attributes) ? { attributes: asObject(row.attributes)! } : {})
    });
  }

  return {
    value: {
      resource: {
        serviceName,
        ...(typeof resource.serviceVersion === "string" ? { serviceVersion: truncate(resource.serviceVersion) } : {}),
        ...(typeof resource.deploymentEnvironment === "string" ? { deploymentEnvironment: truncate(resource.deploymentEnvironment) } : {}),
        ...(typeof resource.hostName === "string" ? { hostName: truncate(resource.hostName) } : {}),
        ...(typeof resource.containerId === "string" ? { containerId: truncate(resource.containerId) } : {}),
        ...(asObject(resource.attributes) ? { attributes: asObject(resource.attributes)! } : {})
      },
      signals: parsedSignals
    }
  };
};

const resourceEvidence = (payload: OtelBridgePayload) => ({
  serviceName: payload.resource.serviceName,
  ...(payload.resource.serviceVersion ? { serviceVersion: payload.resource.serviceVersion } : {}),
  ...(payload.resource.deploymentEnvironment ? { deploymentEnvironment: payload.resource.deploymentEnvironment } : {}),
  ...(payload.resource.hostName ? { hostName: payload.resource.hostName } : {}),
  ...(payload.resource.containerId ? { containerId: payload.resource.containerId } : {}),
  attributes: redactOtelAttributes(payload.resource.attributes, (key) => RESOURCE_ATTRIBUTE_ALLOWLIST.has(key))
});

export const ingestOtelBridgePayload = async (connection: OtelConnection, payload: OtelBridgePayload) => {
  const resource = resourceEvidence(payload);
  const legacyService = connection.projectId
    ? await prisma.service.findFirst({
      where: { projectId: connection.projectId, name: payload.resource.serviceName },
      select: { id: true }
    })
    : null;
  const entity = await prisma.operationalEntity.upsert({
    where: {
      organizationId_entityType_externalId: {
        organizationId: connection.organizationId,
        entityType: "SERVICE",
        externalId: `otel:${payload.resource.serviceName}:${payload.resource.deploymentEnvironment ?? "unknown"}`
      }
    },
    create: {
      id: randomUUID(),
      organizationId: connection.organizationId,
      projectId: connection.projectId,
      legacyServiceId: legacyService?.id,
      entityType: "SERVICE",
      name: payload.resource.serviceName,
      externalId: `otel:${payload.resource.serviceName}:${payload.resource.deploymentEnvironment ?? "unknown"}`,
      provenance: "OTEL_COLLECTOR",
      discoverySource: "OTEL_BRIDGE",
      discoveredAt: new Date(),
      lastSeenAt: new Date(),
      metadataJson: resource as Prisma.InputJsonValue,
      updatedAt: new Date()
    },
    update: {
      projectId: connection.projectId,
      legacyServiceId: legacyService?.id,
      name: payload.resource.serviceName,
      provenance: "OTEL_COLLECTOR",
      discoverySource: "OTEL_BRIDGE",
      lastSeenAt: new Date(),
      metadataJson: resource as Prisma.InputJsonValue,
      updatedAt: new Date()
    }
  });

  const created = await Promise.all(payload.signals.map(async (signal) => {
    const occurredAt = signal.timestamp ? new Date(signal.timestamp) : new Date();
    const signalAttributes = redactOtelAttributes(signal.attributes, (key) => SIGNAL_ATTRIBUTE_ALLOWLIST.test(key));
    const correlation = {
      entityId: entity.id,
      traceId: signal.traceId ?? null,
      spanId: signal.spanId ?? null,
      parentSpanId: signal.parentSpanId ?? null
    };
    const evidence = {
      resource,
      attributes: signalAttributes,
      correlation,
      ...(signal.value !== undefined ? { value: signal.value } : {}),
      ...(signal.body ? { body: signal.body } : {})
    } as Prisma.InputJsonValue;
    await prisma.operationalObservation.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        projectId: connection.projectId,
        sourceType: "OTEL_COLLECTOR",
        sourceId: connection.id,
        eventKey: `OTEL_${signal.kind}`,
        summary: `${payload.resource.serviceName}: ${signal.name}`,
        severity: signal.severity,
        payloadJson: evidence,
        observedAt: occurredAt
      }
    });
    await prisma.operationsTimelineEvent.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        projectId: connection.projectId,
        eventType: `OTEL_${signal.kind}`,
        summary: `${payload.resource.serviceName}: ${signal.name}`,
        sourceType: "OTEL_COLLECTOR",
        sourceId: connection.id,
        severity: signal.severity,
        payloadJson: evidence,
        occurredAt
      }
    });
    return signal.kind;
  }));

  const now = new Date();
  await prisma.connection.update({
    where: { id: connection.id },
    data: { health: "HEALTHY", healthReason: null, installationStatus: "ACTIVE", lastSuccessAt: now, lastError: null, updatedAt: now }
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      action: "OTEL_BRIDGE_ACCEPTED",
      entityType: "CONNECTION",
      entityId: connection.id,
      metadataJson: { organizationId: connection.organizationId, signalCount: created.length, entityId: entity.id }
    }
  });
  return { entityId: entity.id, accepted: created.length };
};
