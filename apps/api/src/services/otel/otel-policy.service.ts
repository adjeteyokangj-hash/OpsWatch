import { createHash } from "crypto";
import type { AlertCategory, AlertSeverity } from "@prisma/client";
import type { NormalizedSignalDraft } from "./otel-normalize";

export type OtelHealth = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export type OtelPolicyDecision = {
  ruleId: string;
  health: OtelHealth;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  fingerprint: string;
  sourceId: string;
  shouldAlert: boolean;
  shouldRecover: boolean;
  isStale: boolean;
};

const recoveryHysteresis = (): number =>
  Number(process.env.OPSWATCH_OTEL_RECOVERY_HYSTERESIS ?? 2);

const fingerprintFor = (parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);

const metricCategory = (name: string): string | null => {
  const lower = name.toLowerCase();
  if (lower.includes("error") || lower.includes("failed")) return "ERROR_RATE";
  if (lower.includes("latency") || lower.includes("duration") || lower.includes("p95")) {
    return "LATENCY";
  }
  if (lower.includes("availability") || lower.includes("up") || lower.includes("success")) {
    return "AVAILABILITY";
  }
  if (lower.includes("queue") || lower.includes("job")) return "QUEUE";
  if (lower.includes("db_") || lower.includes("database")) return "DATABASE";
  return null;
};

export const evaluateOtelSignalPolicy = (
  draft: NormalizedSignalDraft,
  context?: { consecutiveHealthy?: number; isStale?: boolean }
): OtelPolicyDecision | null => {
  if (context?.isStale) {
    const fingerprint = fingerprintFor([
      "otel",
      draft.serviceName,
      draft.environment,
      "STALE",
      draft.signalType
    ]);
    return {
      ruleId: "otel.freshness.stale",
      health: "UNKNOWN",
      severity: "MEDIUM",
      category: "AVAILABILITY",
      title: `OTEL stale: ${draft.serviceName}`,
      message: `No fresh ${draft.signalType} signals for ${draft.serviceName} in ${draft.environment}`,
      fingerprint,
      sourceId: `otel:stale:${fingerprint}`,
      shouldAlert: true,
      shouldRecover: false,
      isStale: true
    };
  }

  if (draft.kind === "METRIC") {
    const category = metricCategory(draft.name);
    if (!category || draft.value === undefined) return null;
    let health: OtelHealth = "HEALTHY";
    let severity: AlertSeverity = "LOW";
    let ruleId = `otel.metric.${category.toLowerCase()}`;
    if (category === "ERROR_RATE") {
      if (draft.value >= 0.05) {
        health = "CRITICAL";
        severity = "CRITICAL";
      } else if (draft.value >= 0.01) {
        health = "DEGRADED";
        severity = "HIGH";
      }
    } else if (category === "LATENCY") {
      if (draft.value >= 2000) {
        health = "CRITICAL";
        severity = "CRITICAL";
      } else if (draft.value >= 500) {
        health = "DEGRADED";
        severity = "HIGH";
      }
    } else if (category === "AVAILABILITY") {
      if (draft.value < 0.95) {
        health = "CRITICAL";
        severity = "CRITICAL";
      } else if (draft.value < 0.99) {
        health = "DEGRADED";
        severity = "MEDIUM";
      }
    } else if (draft.healthImpact === "CRITICAL" || draft.healthImpact === "DEGRADED") {
      health = draft.healthImpact;
      severity = draft.healthImpact === "CRITICAL" ? "CRITICAL" : "HIGH";
    }

    const fingerprint = fingerprintFor([
      "otel",
      draft.serviceName,
      draft.environment,
      ruleId,
      draft.name
    ]);
    const healthyEnough = (context?.consecutiveHealthy ?? 0) >= recoveryHysteresis();
    return {
      ruleId,
      health,
      severity,
      category: category === "DATABASE" ? "DEPENDENCY_CHANGE" : "PERFORMANCE",
      title: `OTEL ${category.toLowerCase()}: ${draft.serviceName}`,
      message: `${draft.name}=${draft.value} (${health}) for ${draft.serviceName}`,
      fingerprint,
      sourceId: `otel:policy:${fingerprint}`,
      shouldAlert: health === "DEGRADED" || health === "CRITICAL",
      shouldRecover: health === "HEALTHY" && healthyEnough,
      isStale: false
    };
  }

  if (draft.kind === "LOG") {
    const body = (draft.body ?? "").toLowerCase();
    const severity = (draft.severity ?? "INFO").toUpperCase();
    const isAuth = /auth|unauthorized|forbidden|401|403/.test(body);
    const isDb = /database|postgres|mysql|mongodb|connection refused/.test(body);
    const isUnhandled = /unhandled|exception|stack trace|fatal/.test(body);
    const isError = ["HIGH", "CRITICAL"].includes(severity) || isUnhandled;
    if (!isError && !isAuth && !isDb) return null;

    const ruleId = isAuth
      ? "otel.log.auth_failure"
      : isDb
        ? "otel.log.database"
        : isUnhandled
          ? "otel.log.unhandled_exception"
          : "otel.log.error";
    const fingerprint = fingerprintFor([
      "otel",
      draft.serviceName,
      draft.environment,
      ruleId,
      draft.logFingerprint ?? draft.name
    ]);
    return {
      ruleId,
      health: severity === "CRITICAL" || isUnhandled ? "CRITICAL" : "DEGRADED",
      severity: severity === "CRITICAL" ? "CRITICAL" : "HIGH",
      category: isAuth ? "SECURITY" : isDb ? "DEPENDENCY_CHANGE" : "AVAILABILITY",
      title: `OTEL log: ${draft.serviceName}`,
      message: `${ruleId} — ${draft.body ?? draft.name}`,
      fingerprint,
      sourceId: `otel:policy:${fingerprint}`,
      shouldAlert: true,
      shouldRecover: false,
      isStale: false
    };
  }

  // SPAN / dependency
  const isError =
    draft.healthImpact === "CRITICAL" ||
    draft.normalizedStatus === "ERROR" ||
    draft.severity === "HIGH" ||
    draft.severity === "CRITICAL";
  const isDependency = draft.signalType === "DEPENDENCY";
  if (!isError && !isDependency) return null;
  if (!isError) return null;

  const ruleId = isDependency ? "otel.span.failed_dependency" : "otel.span.error";
  const fingerprint = fingerprintFor([
    "otel",
    draft.serviceName,
    draft.environment,
    ruleId,
    draft.name,
    String(draft.attributes["peer.service"] ?? draft.attributes["db.system"] ?? "")
  ]);
  return {
    ruleId,
    health: "CRITICAL",
    severity: "CRITICAL",
    category: isDependency ? "DEPENDENCY_CHANGE" : "AVAILABILITY",
    title: `OTEL span failure: ${draft.serviceName}`,
    message: `${draft.name} failed (${draft.normalizedStatus ?? "ERROR"})`,
    fingerprint,
    sourceId: `otel:policy:${fingerprint}`,
    shouldAlert: true,
    shouldRecover: false,
    isStale: false
  };
};
