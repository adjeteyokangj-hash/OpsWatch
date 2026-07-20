import { prisma } from "../../lib/prisma";
import {
  DATA_QUALITY,
  isLearningStageEnabled,
  MIN_DETERIORATION_WINDOWS
} from "./learning-flags";

export type DeteriorationFinding = {
  projectId: string;
  environment: string;
  metricKey: string;
  windows: number;
  startValue: number;
  endValue: number;
  slopePerWindow: number;
  confidenceLabel: string;
  explanation: string;
  dataQualityState: string;
};

/**
 * Gradual deterioration from sustained multi-window evidence.
 * Requires minimum history, freshness, and documented slope.
 */
export const detectDeteriorationForOrg = async (
  organizationId: string
): Promise<{ skipped: boolean; reason?: string; findings: DeteriorationFinding[] }> => {
  if (!isLearningStageEnabled("ANOMALY_DETECTION")) {
    return { skipped: true, reason: "ANOMALY_DETECTION disabled", findings: [] };
  }

  const projects = await prisma.project.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, environment: true }
  });

  const findings: DeteriorationFinding[] = [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const project of projects) {
    const windows = await prisma.apmServiceWindow.findMany({
      where: {
        organizationId,
        projectId: project.id,
        windowEnd: { gte: since }
      },
      orderBy: { windowEnd: "asc" },
      take: 48
    });

    if (windows.length < MIN_DETERIORATION_WINDOWS) continue;

    const errorSeries = windows.map((row) => row.errorRate);
    const latencySeries = windows
      .map((row) => row.latencyP95Ms)
      .filter((value): value is number => typeof value === "number");

    const errorTrend = sustainedRisingTrend(errorSeries);
    if (errorTrend) {
      findings.push({
        projectId: project.id,
        environment: project.environment || "unknown",
        metricKey: "error_rate",
        windows: errorSeries.length,
        startValue: errorTrend.start,
        endValue: errorTrend.end,
        slopePerWindow: errorTrend.slope,
        confidenceLabel: errorSeries.length >= MIN_DETERIORATION_WINDOWS * 2 ? "MODERATE" : "LOW",
        explanation: `Error rate rose from ${errorTrend.start.toFixed(4)} to ${errorTrend.end.toFixed(4)} across ${errorSeries.length} windows (slope ${errorTrend.slope.toFixed(5)}/window). Sustained evidence only — not a guaranteed future failure.`,
        dataQualityState: DATA_QUALITY.LIVE
      });
    }

    if (latencySeries.length >= MIN_DETERIORATION_WINDOWS) {
      const latencyTrend = sustainedRisingTrend(latencySeries);
      if (latencyTrend) {
        findings.push({
          projectId: project.id,
          environment: project.environment || "unknown",
          metricKey: "p95_latency_ms",
          windows: latencySeries.length,
          startValue: latencyTrend.start,
          endValue: latencyTrend.end,
          slopePerWindow: latencyTrend.slope,
          confidenceLabel:
            latencySeries.length >= MIN_DETERIORATION_WINDOWS * 2 ? "MODERATE" : "LOW",
          explanation: `p95 latency worsened from ${latencyTrend.start.toFixed(1)}ms to ${latencyTrend.end.toFixed(1)}ms across ${latencySeries.length} windows. Gradual deterioration candidate.`,
          dataQualityState: DATA_QUALITY.LIVE
        });
      }
    }
  }

  return { skipped: false, findings };
};

export const sustainedRisingTrend = (
  values: number[],
  minWindows = MIN_DETERIORATION_WINDOWS
): { start: number; end: number; slope: number } | null => {
  if (values.length < minWindows) return null;
  const start = values[0]!;
  const end = values[values.length - 1]!;
  if (!(end > start) || start < 0) return null;

  // Require majority of consecutive steps non-decreasing.
  let rising = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! >= values[i - 1]!) rising += 1;
  }
  const ratio = rising / (values.length - 1);
  if (ratio < 0.66) return null;

  const slope = (end - start) / (values.length - 1);
  // Relative increase must be meaningful.
  if (start === 0 && end < 0.01) return null;
  if (start > 0 && end / start < 1.15) return null;

  return { start, end, slope };
};
