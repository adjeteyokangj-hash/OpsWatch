import { createHash } from "crypto";
import { otelMaxSignalsPerBatch } from "./otel-feature-flags";
import {
  isResourceAttributeAllowed,
  isSignalAttributeAllowed,
  redactLogBody,
  redactOtelAttributes
} from "./otel-redaction";

export type OtelSignalKind = "METRIC" | "LOG" | "SPAN";
export type NormalizedSignalType =
  | "METRIC"
  | "LOG"
  | "TRACE"
  | "SPAN"
  | "ERROR"
  | "DEPENDENCY"
  | "SERVICE_HEALTH";

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

export type NormalizedSignalDraft = {
  signalType: NormalizedSignalType;
  kind: OtelSignalKind;
  name: string;
  serviceName: string;
  environment: string;
  resourceIdentity: string;
  observedAt: Date;
  severity?: string;
  value?: number;
  body?: string;
  traceId?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  metricName?: string | null;
  logFingerprint?: string | null;
  normalizedStatus?: string | null;
  fingerprint: string;
  attributes: Record<string, string | number | boolean | null>;
  resourceAttributes: Record<string, string | number | boolean | null>;
  healthImpact: "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
  freshUntil: Date;
};

export type RejectedSignal = { index: number; reason: string };

export type NormalizeBatchResult = {
  protocol: "NORMALIZED_JSON" | "OTLP_HTTP_JSON";
  accepted: NormalizedSignalDraft[];
  rejected: RejectedSignal[];
  resourceGroups: number;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const TRACE_ID_HEX = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX = /^[0-9a-fA-F]{16}$/;

export const isValidTraceId = (value: string | undefined): boolean =>
  !value || TRACE_ID_HEX.test(value);

export const isValidSpanId = (value: string | undefined): boolean =>
  !value || SPAN_ID_HEX.test(value);

const otlpAttributeMap = (value: unknown): Record<string, unknown> => {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<string, unknown>>((attributes, row) => {
    const entry = asObject(row);
    const key = typeof entry?.key === "string" ? entry.key : null;
    const typed = asObject(entry?.value);
    if (!key || !typed) return attributes;
    const next = typed.stringValue ?? typed.boolValue ?? typed.intValue ?? typed.doubleValue;
    if (typeof next === "string" || typeof next === "boolean" || typeof next === "number") {
      attributes[key] = next;
    }
    return attributes;
  }, {});
};

const otlpTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(BigInt(value) / 1_000_000n);
  const parsed = new Date(milliseconds);
  return Number.isFinite(milliseconds) && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString()
    : undefined;
};

const resourceFromAttributes = (resourceAttributes: Record<string, unknown>) => {
  const serviceName =
    typeof resourceAttributes["service.name"] === "string"
      ? resourceAttributes["service.name"]
      : "";
  return {
    serviceName,
    ...(typeof resourceAttributes["service.version"] === "string"
      ? { serviceVersion: resourceAttributes["service.version"] }
      : {}),
    ...(typeof resourceAttributes["deployment.environment"] === "string"
      ? { deploymentEnvironment: resourceAttributes["deployment.environment"] }
      : {}),
    ...(typeof resourceAttributes["host.name"] === "string"
      ? { hostName: resourceAttributes["host.name"] }
      : {}),
    ...(typeof resourceAttributes["container.id"] === "string"
      ? { containerId: resourceAttributes["container.id"] }
      : {}),
    attributes: resourceAttributes
  };
};

type ResourceSignalGroup = {
  resource: OtelBridgePayload["resource"];
  signals: OtelBridgePayload["signals"];
};

const extractOtlpGroups = (body: Record<string, unknown>): ResourceSignalGroup[] => {
  const groups: ResourceSignalGroup[] = [];
  const pushGroup = (
    kind: OtelSignalKind,
    rawGroup: unknown,
    scopeKey: "scopeMetrics" | "scopeLogs" | "scopeSpans"
  ) => {
    const group = asObject(rawGroup);
    if (!group) return;
    const resourceAttributes = otlpAttributeMap(asObject(group.resource)?.attributes);
    const resource = resourceFromAttributes(resourceAttributes);
    if (!resource.serviceName) return;
    const signals: OtelBridgePayload["signals"] = [];
    const scopes = group[scopeKey];
    if (!Array.isArray(scopes)) {
      groups.push({ resource, signals });
      return;
    }
    for (const rawScope of scopes) {
      const scope = asObject(rawScope);
      if (!scope) continue;
      if (kind === "METRIC" && Array.isArray(scope.metrics)) {
        for (const rawMetric of scope.metrics) {
          const metric = asObject(rawMetric);
          const name = typeof metric?.name === "string" ? metric.name : "";
          if (!name) continue;
          const pointSet =
            asObject(metric?.gauge) ?? asObject(metric?.sum) ?? asObject(metric?.histogram);
          const dataPoints = Array.isArray(pointSet?.dataPoints) ? pointSet.dataPoints : [];
          for (const rawPoint of dataPoints) {
            const point = asObject(rawPoint);
            if (!point) continue;
            const rawValue = point.asDouble ?? point.asInt ?? point.count;
            signals.push({
              kind,
              name,
              ...(typeof rawValue === "number" ? { value: rawValue } : {}),
              attributes: otlpAttributeMap(point.attributes),
              ...(otlpTimestamp(point.timeUnixNano)
                ? { timestamp: otlpTimestamp(point.timeUnixNano) }
                : {})
            });
          }
        }
      } else if (kind === "LOG" && Array.isArray(scope.logRecords)) {
        for (const rawLog of scope.logRecords) {
          const log = asObject(rawLog);
          if (!log) continue;
          const bodyValue = asObject(log.body)?.stringValue;
          const severityText =
            typeof log.severityText === "string" ? log.severityText.toUpperCase() : "";
          const traceId =
            typeof log.traceId === "string"
              ? log.traceId
              : typeof log.trace_id === "string"
                ? log.trace_id
                : undefined;
          const spanId =
            typeof log.spanId === "string"
              ? log.spanId
              : typeof log.span_id === "string"
                ? log.span_id
                : undefined;
          signals.push({
            kind,
            name: typeof log.eventName === "string" ? log.eventName : "log",
            ...(typeof bodyValue === "string" ? { body: bodyValue } : {}),
            ...(severityText.includes("FATAL")
              ? { severity: "CRITICAL" as const }
              : severityText.includes("ERROR")
                ? { severity: "HIGH" as const }
                : { severity: "INFO" as const }),
            ...(traceId ? { traceId } : {}),
            ...(spanId ? { spanId } : {}),
            attributes: otlpAttributeMap(log.attributes),
            ...(otlpTimestamp(log.timeUnixNano) ? { timestamp: otlpTimestamp(log.timeUnixNano) } : {})
          });
        }
      } else if (kind === "SPAN" && Array.isArray(scope.spans)) {
        for (const rawSpan of scope.spans) {
          const span = asObject(rawSpan);
          if (!span) continue;
          const statusCode = asObject(span.status)?.code;
          signals.push({
            kind,
            name: typeof span.name === "string" ? span.name : "span",
            ...(typeof span.traceId === "string" ? { traceId: span.traceId } : {}),
            ...(typeof span.spanId === "string" ? { spanId: span.spanId } : {}),
            ...(typeof span.parentSpanId === "string" ? { parentSpanId: span.parentSpanId } : {}),
            ...(statusCode === 2 || statusCode === "STATUS_CODE_ERROR"
              ? { severity: "HIGH" as const }
              : { severity: "INFO" as const }),
            attributes: otlpAttributeMap(span.attributes),
            ...(otlpTimestamp(span.endTimeUnixNano ?? span.startTimeUnixNano)
              ? { timestamp: otlpTimestamp(span.endTimeUnixNano ?? span.startTimeUnixNano) }
              : {})
          });
        }
      }
    }
    groups.push({ resource, signals });
  };

  if (Array.isArray(body.resourceMetrics)) {
    for (const group of body.resourceMetrics) pushGroup("METRIC", group, "scopeMetrics");
  }
  if (Array.isArray(body.resourceLogs)) {
    for (const group of body.resourceLogs) pushGroup("LOG", group, "scopeLogs");
  }
  if (Array.isArray(body.resourceSpans)) {
    for (const group of body.resourceSpans) pushGroup("SPAN", group, "scopeSpans");
  }
  return groups;
};

const buildFingerprint = (parts: Array<string | number | null | undefined>): string =>
  createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 40);

const classifySignal = (
  signal: OtelBridgePayload["signals"][number],
  resource: OtelBridgePayload["resource"]
): Pick<
  NormalizedSignalDraft,
  "signalType" | "healthImpact" | "normalizedStatus" | "metricName" | "logFingerprint"
> => {
  const attrs = signal.attributes ?? {};
  if (signal.kind === "METRIC") {
    const name = signal.name.toLowerCase();
    let healthImpact: NormalizedSignalDraft["healthImpact"] = "UNKNOWN";
    if (name.includes("error") && typeof signal.value === "number" && signal.value > 0) {
      healthImpact = signal.value >= 0.05 ? "CRITICAL" : "DEGRADED";
    }
    return {
      signalType: "METRIC",
      healthImpact,
      normalizedStatus: null,
      metricName: signal.name,
      logFingerprint: null
    };
  }
  if (signal.kind === "LOG") {
    const severity = (signal.severity ?? "INFO").toUpperCase();
    const body = (signal.body ?? "").toLowerCase();
    const isError = ["HIGH", "CRITICAL"].includes(severity) || body.includes("exception");
    return {
      signalType: isError ? "ERROR" : "LOG",
      healthImpact: severity === "CRITICAL" ? "CRITICAL" : isError ? "DEGRADED" : "UNKNOWN",
      normalizedStatus: severity,
      metricName: null,
      logFingerprint: buildFingerprint([
        resource.serviceName,
        signal.name,
        body.slice(0, 120),
        severity
      ])
    };
  }
  const statusCode = attrs["otel.status_code"] ?? attrs["http.status_code"];
  const isError =
    signal.severity === "HIGH" ||
    signal.severity === "CRITICAL" ||
    statusCode === "ERROR" ||
    statusCode === 2 ||
    (typeof statusCode === "number" && statusCode >= 500);
  const peer =
    typeof attrs["peer.service"] === "string" ||
    typeof attrs["db.system"] === "string" ||
    typeof attrs["messaging.system"] === "string" ||
    typeof attrs["server.address"] === "string";
  if (peer) {
    return {
      signalType: "DEPENDENCY",
      healthImpact: isError ? "CRITICAL" : "UNKNOWN",
      normalizedStatus: isError ? "ERROR" : "OK",
      metricName: null,
      logFingerprint: null
    };
  }
  return {
    signalType: isError ? "ERROR" : "SPAN",
    healthImpact: isError ? "CRITICAL" : "UNKNOWN",
    normalizedStatus: isError ? "ERROR" : "OK",
    metricName: null,
    logFingerprint: null
  };
};

const freshnessForKind = (kind: OtelSignalKind, observedAt: Date) => {
  const spanLogMs = Number(process.env.OPSWATCH_OTEL_SPAN_LOG_FRESH_MS ?? 15 * 60_000);
  const metricMs = Number(process.env.OPSWATCH_OTEL_METRIC_FRESH_MS ?? 10 * 60_000);
  const ttl = kind === "METRIC" ? metricMs : spanLogMs;
  return new Date(observedAt.getTime() + ttl);
};

export const parseOtelBridgePayload = (
  input: unknown
): { value?: OtelBridgePayload; error?: string } => {
  const body = asObject(input);
  if (!body) return { error: "Telemetry body must be an object" };

  if (
    Array.isArray(body.resourceMetrics) ||
    Array.isArray(body.resourceLogs) ||
    Array.isArray(body.resourceSpans)
  ) {
    const groups = extractOtlpGroups(body);
    if (groups.length === 0) return { error: "OTLP payload contained no valid resource groups" };
    const first = groups[0]!;
    const signals = groups.flatMap((group) =>
      group.signals.map((signal) => ({
        ...signal,
        attributes: {
          ...(group.resource.attributes ?? {}),
          ...(signal.attributes ?? {}),
          "opswatch.resource.service.name": group.resource.serviceName,
          ...(group.resource.deploymentEnvironment
            ? {
                "opswatch.resource.deployment.environment":
                  group.resource.deploymentEnvironment
              }
            : {})
        }
      }))
    );
    return parseOtelBridgePayload({
      resource: first.resource,
      signals
    });
  }

  const resource = asObject(body.resource);
  const signals = Array.isArray(body.signals) ? body.signals : null;
  const serviceName = typeof resource?.serviceName === "string" ? resource.serviceName.trim() : "";
  if (!resource || !serviceName || serviceName.length > 200) {
    return { error: "resource.serviceName is required and must be at most 200 characters" };
  }
  const maxSignals = otelMaxSignalsPerBatch();
  if (!signals || signals.length === 0 || signals.length > maxSignals) {
    return { error: `signals must contain between 1 and ${maxSignals} records` };
  }

  const parsedSignals: OtelBridgePayload["signals"] = [];
  for (const signal of signals) {
    const row = asObject(signal);
    if (!row) return { error: "each signal must be an object" };
    const kind = typeof row.kind === "string" ? row.kind.toUpperCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!["METRIC", "LOG", "SPAN"].includes(kind) || !name || name.length > 300) {
      return {
        error: "each signal requires kind METRIC, LOG, or SPAN and a name of at most 300 characters"
      };
    }
    const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if (timestamp && Number.isNaN(Date.parse(timestamp))) {
      return { error: "signal.timestamp must be an ISO date when provided" };
    }
    if (row.value !== undefined && (typeof row.value !== "number" || !Number.isFinite(row.value))) {
      return { error: "signal.value must be a finite number when provided" };
    }
    const traceId = typeof row.traceId === "string" ? row.traceId : undefined;
    const spanId = typeof row.spanId === "string" ? row.spanId : undefined;
    const parentSpanId = typeof row.parentSpanId === "string" ? row.parentSpanId : undefined;
    if (!isValidTraceId(traceId) || !isValidSpanId(spanId) || !isValidSpanId(parentSpanId)) {
      return { error: "traceId must be 32-char hex and span IDs must be 16-char hex when provided" };
    }
    parsedSignals.push({
      kind: kind as OtelSignalKind,
      name,
      ...(timestamp ? { timestamp } : {}),
      ...(typeof row.severity === "string" &&
      ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(row.severity.toUpperCase())
        ? { severity: row.severity.toUpperCase() as OtelBridgePayload["signals"][number]["severity"] }
        : {}),
      ...(typeof row.value === "number" ? { value: row.value } : {}),
      ...(typeof row.body === "string" ? { body: redactLogBody(row.body) } : {}),
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
      ...(parentSpanId ? { parentSpanId } : {}),
      ...(asObject(row.attributes) ? { attributes: asObject(row.attributes)! } : {})
    });
  }

  return {
    value: {
      resource: {
        serviceName,
        ...(typeof resource.serviceVersion === "string"
          ? { serviceVersion: resource.serviceVersion.slice(0, 200) }
          : {}),
        ...(typeof resource.deploymentEnvironment === "string"
          ? { deploymentEnvironment: resource.deploymentEnvironment.slice(0, 100) }
          : {}),
        ...(typeof resource.hostName === "string" ? { hostName: resource.hostName.slice(0, 200) } : {}),
        ...(typeof resource.containerId === "string"
          ? { containerId: resource.containerId.slice(0, 200) }
          : {}),
        ...(asObject(resource.attributes) ? { attributes: asObject(resource.attributes)! } : {})
      },
      signals: parsedSignals
    }
  };
};

export const normalizeOtelBatch = (
  payload: OtelBridgePayload,
  options?: { protocol?: NormalizeBatchResult["protocol"] }
): NormalizeBatchResult => {
  const accepted: NormalizedSignalDraft[] = [];
  const rejected: RejectedSignal[] = [];
  const environment = payload.resource.deploymentEnvironment ?? "unknown";
  const resourceAttributes = redactOtelAttributes(
    payload.resource.attributes,
    isResourceAttributeAllowed
  );
  const resourceIdentity = [
    payload.resource.serviceName,
    environment,
    payload.resource.hostName ?? "",
    payload.resource.containerId ?? ""
  ].join(":");

  payload.signals.forEach((signal, index) => {
    if (!isValidTraceId(signal.traceId) || !isValidSpanId(signal.spanId)) {
      rejected.push({ index, reason: "invalid_trace_or_span_id" });
      return;
    }
    const observedAt = signal.timestamp ? new Date(signal.timestamp) : new Date();
    if (Number.isNaN(observedAt.getTime())) {
      rejected.push({ index, reason: "invalid_timestamp" });
      return;
    }
    const classified = classifySignal(signal, payload.resource);
    const attributes = redactOtelAttributes(signal.attributes, isSignalAttributeAllowed);
    const fingerprint = buildFingerprint([
      payload.resource.serviceName,
      environment,
      classified.signalType,
      signal.name,
      classified.metricName,
      classified.logFingerprint,
      signal.traceId,
      classified.normalizedStatus
    ]);
    accepted.push({
      ...classified,
      kind: signal.kind,
      name: signal.name,
      serviceName: payload.resource.serviceName,
      environment,
      resourceIdentity,
      observedAt,
      severity: signal.severity,
      value: signal.value,
      body: redactLogBody(signal.body),
      traceId: signal.traceId ?? null,
      spanId: signal.spanId ?? null,
      parentSpanId: signal.parentSpanId ?? null,
      fingerprint,
      attributes,
      resourceAttributes,
      freshUntil: freshnessForKind(signal.kind, observedAt)
    });
  });

  return {
    protocol: options?.protocol ?? "NORMALIZED_JSON",
    accepted,
    rejected,
    resourceGroups: 1
  };
};

export const detectOtelProtocol = (input: unknown): NormalizeBatchResult["protocol"] => {
  const body = asObject(input);
  if (
    body &&
    (Array.isArray(body.resourceMetrics) ||
      Array.isArray(body.resourceLogs) ||
      Array.isArray(body.resourceSpans))
  ) {
    return "OTLP_HTTP_JSON";
  }
  return "NORMALIZED_JSON";
};

export const hashOtelIdempotency = (connectionId: string, rawBody: Buffer): string =>
  createHash("sha256").update(connectionId).update(":").update(rawBody).digest("hex");

export { freshnessForKind };
