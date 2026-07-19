import {
  MIN_SAMPLES_FOR_HEALTH,
  MIN_SAMPLES_FOR_P95
} from "./logs-apm-feature-flags";

export type ApmHealth = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export type ApmHealthEvaluation = {
  health: ApmHealth;
  rule: string;
  evidence: {
    threshold: Record<string, number | null>;
    evidenceWindow: string;
    sampleCount: number;
    lastEvaluated: string;
    freshness: "FRESH" | "STALE" | "EXPIRED";
    messages: string[];
  };
};

const DEFAULT_ERROR_RATE_WARN = 0.05;
const DEFAULT_ERROR_RATE_CRIT = 0.2;
const DEFAULT_LATENCY_DEVIATION = 1.5;

/**
 * Evidence-based APM health. Not prediction — deterministic thresholds / baselines.
 */
export const evaluateApmHealth = (input: {
  errorRate: number;
  latencyP95Ms: number | null;
  sampleCount: number;
  baselineLatencyP95Ms?: number | null;
  baselineErrorRate?: number | null;
  freshUntil: Date;
  now: Date;
  dependencyFailed?: boolean;
  fixedErrorRateWarn?: number;
  fixedErrorRateCrit?: number;
}): ApmHealthEvaluation => {
  const messages: string[] = [];
  const freshness =
    input.now.getTime() > input.freshUntil.getTime()
      ? ("STALE" as const)
      : ("FRESH" as const);

  if (freshness === "STALE") {
    return {
      health: "UNKNOWN",
      rule: "stale_evidence",
      evidence: {
        threshold: {},
        evidenceWindow: "source_window",
        sampleCount: input.sampleCount,
        lastEvaluated: input.now.toISOString(),
        freshness,
        messages: ["Insufficient recent evidence — health is Unknown"]
      }
    };
  }

  if (input.sampleCount < MIN_SAMPLES_FOR_HEALTH) {
    return {
      health: "UNKNOWN",
      rule: "insufficient_samples",
      evidence: {
        threshold: { minSamples: MIN_SAMPLES_FOR_HEALTH },
        evidenceWindow: "source_window",
        sampleCount: input.sampleCount,
        lastEvaluated: input.now.toISOString(),
        freshness,
        messages: ["Insufficient samples"]
      }
    };
  }

  const warn = input.fixedErrorRateWarn ?? DEFAULT_ERROR_RATE_WARN;
  const crit = input.fixedErrorRateCrit ?? DEFAULT_ERROR_RATE_CRIT;

  if (input.dependencyFailed && input.errorRate >= crit) {
    messages.push("Failed dependency");
    return {
      health: "CRITICAL",
      rule: "dependency_failure",
      evidence: {
        threshold: { errorRateCrit: crit },
        evidenceWindow: "source_window",
        sampleCount: input.sampleCount,
        lastEvaluated: input.now.toISOString(),
        freshness,
        messages
      }
    };
  }

  if (input.errorRate >= crit) {
    messages.push("Error rate exceeds baseline");
    messages.push("Threshold exceeded");
    return {
      health: "CRITICAL",
      rule: "error_rate_critical",
      evidence: {
        threshold: { errorRateCrit: crit },
        evidenceWindow: "source_window",
        sampleCount: input.sampleCount,
        lastEvaluated: input.now.toISOString(),
        freshness,
        messages
      }
    };
  }

  let degraded = false;
  if (input.errorRate >= warn) {
    degraded = true;
    messages.push("Error rate exceeds baseline");
  }

  if (
    input.latencyP95Ms !== null &&
    input.sampleCount >= MIN_SAMPLES_FOR_P95 &&
    input.baselineLatencyP95Ms &&
    input.baselineLatencyP95Ms > 0 &&
    input.latencyP95Ms > input.baselineLatencyP95Ms * DEFAULT_LATENCY_DEVIATION
  ) {
    degraded = true;
    messages.push("Above normal latency");
  }

  if (degraded) {
    return {
      health: "DEGRADED",
      rule: "elevated_latency_or_errors",
      evidence: {
        threshold: {
          errorRateWarn: warn,
          latencyDeviation: DEFAULT_LATENCY_DEVIATION,
          baselineLatencyP95Ms: input.baselineLatencyP95Ms ?? null
        },
        evidenceWindow: "source_window",
        sampleCount: input.sampleCount,
        lastEvaluated: input.now.toISOString(),
        freshness,
        messages
      }
    };
  }

  messages.push("Recent successful evidence within threshold");
  return {
    health: "HEALTHY",
    rule: "within_threshold",
    evidence: {
      threshold: { errorRateWarn: warn },
      evidenceWindow: "source_window",
      sampleCount: input.sampleCount,
      lastEvaluated: input.now.toISOString(),
      freshness,
      messages
    }
  };
};
