/**
 * Visible AI Operations Status — runtime proof, not env-flag labels.
 * Tones: green = enabled + recent evidence; amber = enabled but waiting;
 * red = disabled / monitor-only / stale worker / predictions off.
 */

import { prisma } from "../../lib/prisma";
import { resolveEffectiveEnvFlag, resolveAiOperatingProfile } from "./ai-operating-profile.service";
import { isFeatureGateEnabled } from "./feature-gates.service";
import { isLearningStageEnabled } from "../learning/learning-flags";
import { normalizeProjectAutonomousMode } from "@opswatch/shared";
import { buildEffectivePolicySnapshot } from "../policy/effective-policy-snapshot.service";

export type OpsStatusTone = "green" | "amber" | "red";

export type OpsStatusCapability = {
  id: string;
  label: string;
  tone: OpsStatusTone;
  summary: string;
  lastEvidenceAt: string | null;
  evidence: Record<string, unknown>;
};

export type OpsStatusBlocked = {
  id: string;
  label: string;
  reason: string;
};

export type OpsStatusRecentDecision = {
  id: string;
  kind: "audit" | "automation" | "prediction";
  summary: string;
  decisionType: string | null;
  confidence: number | null;
  outcome: string | null;
  at: string;
};

export type AiOperationsStatusPayload = {
  asOf: string;
  overall: {
    modeLabel: string;
    tone: OpsStatusTone;
    summary: string;
  };
  lastAiDecision: {
    at: string | null;
    summary: string | null;
    kind: string | null;
  };
  capabilities: OpsStatusCapability[];
  blocked: OpsStatusBlocked[];
  recentDecisions: OpsStatusRecentDecision[];
};

const MS_10M = 10 * 60_000;
const MS_20M = 20 * 60_000;
const MS_24H = 24 * 60 * 60_000;
const MS_7D = 7 * 24 * 60 * 60_000;

const ageMs = (at: Date | null | undefined, now: Date): number | null => {
  if (!at) return null;
  return now.getTime() - at.getTime();
};

export const toneFromHeartbeatAge = (receivedAt: Date | null, now: Date = new Date()): OpsStatusTone => {
  const age = ageMs(receivedAt, now);
  if (age === null) return "red";
  if (age < MS_10M) return "green";
  if (age < MS_20M) return "amber";
  return "red";
};

const toneFromHeartbeat = toneFromHeartbeatAge;

const maxDate = (...dates: Array<Date | null | undefined>): Date | null => {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
};

export const buildAiOperationsStatus = async (input: {
  organizationId: string;
  projectId?: string;
}): Promise<AiOperationsStatusPayload> => {
  const now = new Date();
  const orgId = input.organizationId;
  const projectFilter = input.projectId
    ? { organizationId: orgId, id: input.projectId }
    : { organizationId: orgId };

  const profile = resolveAiOperatingProfile();
  const snapshot = await buildEffectivePolicySnapshot({
    organizationId: orgId,
    projectId: input.projectId
  });
  const areaById = Object.fromEntries(snapshot.areas.map((a) => [a.id, a]));
  const snapshotTone = (id: string): OpsStatusTone =>
    (areaById[id]?.tone as OpsStatusTone | undefined) ?? "red";
  const areaSummary = (id: string, fallback: string): string => {
    const area = areaById[id];
    if (!area) return fallback;
    if (area.blocker) return area.blocker;
    if (!area.effective) return `${area.label} is not effective (requested ${area.requested ? "on" : "off"}).`;
    return `${area.label} is effective.`;
  };
  const orgEffective = String(snapshot.org.effectiveMode ?? "").toUpperCase();

  const predictionsEnabled = resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED");
  const learningEnabled =
    isLearningStageEnabled("BASELINE_CALCULATION") ||
    isLearningStageEnabled("ANOMALY_DETECTION") ||
    isLearningStageEnabled("INCIDENT_MATCHING");
  const advancedRcaEnabled = isFeatureGateEnabled("ADVANCED_RCA");
  const autoHealDefault = resolveEffectiveEnvFlag("AUTO_HEAL_DEFAULT_ENABLED");
  const autoRepairEnabled = resolveEffectiveEnvFlag("OPSWATCH_AUTO_REPAIR_ENABLED");

  const [
    latestHeartbeat,
    latestAudit,
    latestAutomation,
    latestPrediction,
    predictionCount,
    baselineCount,
    metricBaselines,
    anomalyCount,
    memoryCount,
    projects,
    remediatorIntegrations,
    recentAudits,
    recentAutomations,
    recentPredictions
  ] = await Promise.all([
    prisma.heartbeat.findFirst({
      where: { Project: projectFilter },
      orderBy: { receivedAt: "desc" },
      select: {
        receivedAt: true,
        status: true,
        projectId: true,
        Project: { select: { name: true, slug: true } }
      }
    }),
    prisma.aiDecisionAudit.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        summary: true,
        decisionType: true,
        confidenceScore: true,
        outcome: true
      }
    }),
    prisma.automationRun.findFirst({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        status: true,
        triggerType: true,
        confidence: true,
        verificationStatus: true,
        reason: true,
        executionMode: true
      }
    }),
    prisma.predictionCandidate.findFirst({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      },
      orderBy: { computedAt: "desc" },
      select: {
        id: true,
        computedAt: true,
        title: true,
        confidenceScore: true,
        status: true,
        reviewState: true,
        summary: true
      }
    }),
    prisma.predictionCandidate.count({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        computedAt: { gte: new Date(now.getTime() - MS_7D) }
      }
    }),
    prisma.learningBaseline.count({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        updatedAt: { gte: new Date(now.getTime() - MS_7D) }
      }
    }),
    prisma.metricBaseline.count({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        lastRecalculatedAt: { gte: new Date(now.getTime() - MS_7D) }
      }
    }),
    prisma.anomalyRecord.count({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        lastDetectedAt: { gte: new Date(now.getTime() - MS_7D) }
      }
    }),
    prisma.incidentMemoryEntry.count({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        OR: [
          { createdAt: { gte: new Date(now.getTime() - MS_7D) } },
          { resolvedAt: { gte: new Date(now.getTime() - MS_7D) } }
        ]
      }
    }),
    prisma.project.findMany({
      where: projectFilter,
      select: {
        id: true,
        name: true,
        automationMode: true,
        remediationEmergencyDisabled: true
      },
      take: 100
    }),
    prisma.projectIntegration.findMany({
      where: {
        Project: projectFilter,
        enabled: true
      },
      select: {
        id: true,
        projectId: true,
        type: true,
        validationStatus: true,
        configJson: true,
        name: true
      },
      take: 200
    }),
    prisma.aiDecisionAudit.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        summary: true,
        decisionType: true,
        confidenceScore: true,
        outcome: true
      }
    }),
    prisma.automationRun.findMany({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        status: true,
        triggerType: true,
        confidence: true,
        verificationStatus: true,
        reason: true
      }
    }),
    prisma.predictionCandidate.findMany({
      where: {
        organizationId: orgId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      },
      orderBy: { computedAt: "desc" },
      take: 3,
      select: {
        id: true,
        computedAt: true,
        title: true,
        confidenceScore: true,
        status: true,
        reviewState: true
      }
    })
  ]);

  const learningBaselineCount = typeof baselineCount === "number" ? baselineCount : 0;
  const metricBaselineCount = typeof metricBaselines === "number" ? metricBaselines : 0;
  const baselineTotal = learningBaselineCount + metricBaselineCount;
  const anomalyTotal = typeof anomalyCount === "number" ? anomalyCount : 0;
  const memoryTotal = typeof memoryCount === "number" ? memoryCount : 0;

  const remediatorConnected = remediatorIntegrations.some((row) => {
    const blob = `${row.type} ${row.name ?? ""} ${JSON.stringify(row.configJson ?? {})}`.toUpperCase();
    const looksRemediator =
      blob.includes("REMEDIATOR") ||
      blob.includes("RESTART_SERVICE") ||
      blob.includes("ROLLBACK_DEPLOYMENT") ||
      blob.includes("RETRY_FAILED");
    if (!looksRemediator) return false;
    return row.validationStatus === "VALID" || row.validationStatus === "UNKNOWN";
  });

  const hbTone = toneFromHeartbeat(latestHeartbeat?.receivedAt ?? null, now);
  const hbAge = ageMs(latestHeartbeat?.receivedAt ?? null, now);

  const healModes = projects.filter((p) => {
    const mode = normalizeProjectAutonomousMode(p.automationMode);
    return mode === "AUTO_HEAL_SAFE" || mode === "FULL_AUTONOMOUS";
  });
  const snapshotOrgMonitorOnly =
    orgEffective === "MONITOR_ONLY" ||
    orgEffective === "OBSERVE" ||
    orgEffective === "DISABLED" ||
    !snapshot.org.enabled;
  const monitorOnlyAll =
    snapshotOrgMonitorOnly ||
    (projects.length > 0 &&
      projects.every((p) => {
        const mode = normalizeProjectAutonomousMode(p.automationMode);
        return mode === "MONITOR_ONLY" || mode === "DISABLED";
      }));
  const emergencyAny = projects.some((p) => p.remediationEmergencyDisabled);

  // Worker heartbeat
  const workerCapability: OpsStatusCapability = {
    id: "worker_heartbeat",
    label: "Worker heartbeat",
    tone: hbTone,
    summary:
      hbTone === "green"
        ? `Recent pulse from ${latestHeartbeat?.Project?.name ?? "an application"} (${Math.round((hbAge ?? 0) / 60_000)}m ago).`
        : hbTone === "amber"
          ? `Heartbeat is aging (${Math.round((hbAge ?? 0) / 60_000)}m). Expect MEDIUM stale shortly.`
          : latestHeartbeat
            ? `Heartbeat stale (${Math.round((hbAge ?? 0) / 60_000)}m). Worker or client pulse may be down.`
            : "No heartbeat recorded yet for this organization.",
    lastEvidenceAt: latestHeartbeat?.receivedAt?.toISOString() ?? null,
    evidence: {
      projectId: latestHeartbeat?.projectId ?? null,
      projectName: latestHeartbeat?.Project?.name ?? null,
      status: latestHeartbeat?.status ?? null,
      ageMs: hbAge
    }
  };

  // Prediction engine
  const predRecent =
    latestPrediction?.computedAt &&
    ageMs(latestPrediction.computedAt, now)! < MS_7D;
  let predictionTone: OpsStatusTone = "red";
  let predictionSummary = "Prediction engine is off.";
  if (!predictionsEnabled) {
    predictionTone = "red";
    predictionSummary = "Predictions are disabled — no live forecast emission.";
  } else if (predictionCount > 0 && predRecent) {
    predictionTone = "green";
    predictionSummary = `${predictionCount} candidate(s) in the last 7 days; latest confidence ${((latestPrediction?.confidenceScore ?? 0) * 100).toFixed(0)}%.`;
  } else {
    predictionTone = "amber";
    predictionSummary =
      "Prediction engine is on but waiting for enough evidence to emit confidence-gated candidates.";
  }
  const predictionCapability: OpsStatusCapability = {
    id: "prediction_engine",
    label: "Prediction engine",
    tone: predictionTone,
    summary: predictionSummary,
    lastEvidenceAt: latestPrediction?.computedAt?.toISOString() ?? null,
    evidence: {
      enabled: predictionsEnabled,
      candidatesStored7d: predictionCount,
      latestTitle: latestPrediction?.title ?? null,
      latestConfidence: latestPrediction?.confidenceScore ?? null,
      latestStatus: latestPrediction?.status ?? null,
      latestReviewState: latestPrediction?.reviewState ?? null
    }
  };

  // Learning engine
  const learningActivity = baselineTotal + anomalyTotal;
  let learningTone: OpsStatusTone = "red";
  let learningSummary = "Learning engine is off.";
  if (!learningEnabled) {
    learningTone = "red";
    learningSummary = "Learning stages are disabled.";
  } else if (learningActivity > 0 || memoryTotal > 0) {
    learningTone = "green";
    learningSummary = `Learning active — ${baselineTotal} baseline update(s), ${anomalyTotal} anomal${anomalyTotal === 1 ? "y" : "ies"}, ${memoryTotal} incident memor${memoryTotal === 1 ? "y" : "ies"} (7d).`;
  } else {
    learningTone = "amber";
    learningSummary = "Learning is on but waiting for operational samples to build baselines.";
  }
  const learningCapability: OpsStatusCapability = {
    id: "learning_engine",
    label: "Learning engine",
    tone: learningTone,
    summary: learningSummary,
    lastEvidenceAt: null,
    evidence: {
      enabled: learningEnabled,
      baselines7d: baselineTotal,
      anomalies7d: anomalyTotal,
      memories7d: memoryTotal
    }
  };

  // Advanced diagnosis
  const diagnosisAudit =
    latestAudit &&
    /DIAGNOS|RCA|RECOMMEND|OBSERVE|AUTOMATE|RECOVERY/i.test(latestAudit.decisionType ?? "");
  const diagnosisRecent =
    diagnosisAudit && ageMs(latestAudit.createdAt, now)! < MS_7D;
  let diagnosisTone: OpsStatusTone = "red";
  let diagnosisSummary = "Advanced diagnosis is off.";
  if (!advancedRcaEnabled && !diagnosisRecent && memoryTotal === 0) {
    diagnosisTone = "red";
    diagnosisSummary = "Advanced diagnosis overlays are disabled and no recent diagnosis evidence exists.";
  } else if (diagnosisRecent || memoryTotal > 0) {
    diagnosisTone = "green";
    diagnosisSummary = diagnosisRecent
      ? `Recent AI decision: ${latestAudit!.decisionType} — ${latestAudit!.summary}`
      : `${memoryTotal} incident memor${memoryTotal === 1 ? "y" : "ies"} with diagnosis evidence (7d).`;
  } else {
    diagnosisTone = "amber";
    diagnosisSummary = advancedRcaEnabled
      ? "Advanced diagnosis is enabled; waiting for an incident to diagnose."
      : "Waiting for diagnosis evidence (advanced RCA flag off, but core diagnosis may still run).";
  }
  const diagnosisCapability: OpsStatusCapability = {
    id: "advanced_diagnosis",
    label: "Advanced diagnosis",
    tone: diagnosisTone,
    summary: diagnosisSummary,
    lastEvidenceAt: diagnosisRecent ? latestAudit!.createdAt.toISOString() : null,
    evidence: {
      advancedRcaEnabled,
      latestDecisionType: latestAudit?.decisionType ?? null,
      memories7d: memoryTotal
    }
  };

  // Safe auto-healing
  let healTone: OpsStatusTone = "red";
  let healSummary = "Safe auto-healing is not active.";
  const autoRunRecent =
    latestAutomation &&
    ageMs(latestAutomation.createdAt, now)! < MS_7D &&
    /AUTO|AUTONOMOUS|SCHEDULE|ALERT|INCIDENT/i.test(
      `${latestAutomation.executionMode ?? ""} ${latestAutomation.triggerType ?? ""}`
    );
  if (monitorOnlyAll || emergencyAny) {
    healTone = "red";
    healSummary = emergencyAny
      ? "Emergency stop is engaged on at least one application — auto-heal clamped."
      : "Applications are in Monitor Only (or equivalent) — auto-heal will not execute.";
  } else if (!autoHealDefault && healModes.length === 0) {
    healTone = "red";
    healSummary = "No application is in Auto-Heal Safe Actions mode.";
  } else if (!remediatorConnected && healModes.length > 0) {
    healTone = "amber";
    healSummary = "Auto-Heal mode is set, but no connected remediator was found — waiting for credentials/setup.";
  } else if (autoRunRecent) {
    healTone = "green";
    healSummary = `Safe auto-heal evidence: run ${latestAutomation!.status}${latestAutomation!.verificationStatus ? `, verification ${latestAutomation!.verificationStatus}` : ""} (${latestAutomation!.triggerType ?? "trigger n/a"}).`;
  } else if (healModes.length > 0 || autoHealDefault) {
    healTone = "amber";
    healSummary = remediatorConnected
      ? "Auto-Heal Safe Actions is configured; waiting for an allowlisted incident to act on."
      : "Auto-heal defaults are on; connect a remediator and set an app to Auto-Heal Safe Actions.";
  }
  const healCapability: OpsStatusCapability = {
    id: "safe_auto_healing",
    label: "Safe auto-healing",
    tone: healTone,
    summary: healSummary,
    lastEvidenceAt: latestAutomation?.createdAt?.toISOString() ?? null,
    evidence: {
      autoHealDefault,
      autoRepairEnabled,
      appsInHealMode: healModes.length,
      remediatorConnected,
      emergencyStop: emergencyAny,
      latestRunStatus: latestAutomation?.status ?? null,
      latestVerification: latestAutomation?.verificationStatus ?? null,
      latestTrigger: latestAutomation?.triggerType ?? null,
      latestConfidence: latestAutomation?.confidence ?? null
    }
  };

  const lastDecisionAt = maxDate(
    latestAudit?.createdAt,
    latestAutomation?.createdAt,
    latestPrediction?.computedAt
  );
  const lastDecisionSummary =
    lastDecisionAt && latestAudit && latestAudit.createdAt.getTime() === lastDecisionAt.getTime()
      ? latestAudit.summary
      : lastDecisionAt &&
          latestAutomation &&
          latestAutomation.createdAt.getTime() === lastDecisionAt.getTime()
        ? latestAutomation.reason ?? `Automation ${latestAutomation.status}`
        : lastDecisionAt &&
            latestPrediction &&
            latestPrediction.computedAt.getTime() === lastDecisionAt.getTime()
          ? latestPrediction.title
          : null;
  const lastDecisionKind =
    lastDecisionAt && latestAudit && latestAudit.createdAt.getTime() === lastDecisionAt.getTime()
      ? "audit"
      : lastDecisionAt &&
          latestAutomation &&
          latestAutomation.createdAt.getTime() === lastDecisionAt.getTime()
        ? "automation"
        : lastDecisionAt
          ? "prediction"
          : null;

  const lastDecisionRecent = lastDecisionAt && ageMs(lastDecisionAt, now)! < MS_24H;
  const lastDecisionCapability: OpsStatusCapability = {
    id: "last_ai_decision",
    label: "Last AI decision",
    tone: lastDecisionRecent ? "green" : lastDecisionAt ? "amber" : "red",
    summary: lastDecisionAt
      ? lastDecisionRecent
        ? lastDecisionSummary ?? "Recent AI decision recorded."
        : `Last decision is older than 24h: ${lastDecisionSummary ?? "see audit trail"}.`
      : "No AI decision, automation run, or prediction candidate recorded yet.",
    lastEvidenceAt: lastDecisionAt?.toISOString() ?? null,
    evidence: {
      kind: lastDecisionKind,
      summary: lastDecisionSummary
    }
  };

  // Overall mode ? prefer canonical policy snapshot over env-only profile
  const orgIsAiLed =
    orgEffective === "AUTO_HEAL_SAFE" ||
    orgEffective === "FULL_AUTONOMOUS" ||
    orgEffective === "AUTONOMOUS" ||
    snapshot.operatingProfile === "AI_LED_SAFE" ||
    snapshot.operatingProfile === "FULL_AUTONOMOUS";
  let overallTone: OpsStatusTone = "red";
  let modeLabel = "Safety-gated";
  let overallSummary = "AI-led operations are not active.";
  if (orgIsAiLed || profile === "ai_led_safe") {
    if (hbTone === "green" && lastDecisionRecent && predictionTone !== "red" && learningTone !== "red") {
      modeLabel = "AI-led operations active";
      overallTone = "green";
      overallSummary =
        "AI-led safe profile is live: worker pulse is fresh and recent AI decisions are on record.";
    } else if (hbTone === "red" || (predictionTone === "red" && !predictionsEnabled)) {
      modeLabel = "AI-led configured — blocked";
      overallTone = "red";
      overallSummary =
        hbTone === "red"
          ? "AI-led profile is configured, but worker heartbeat is missing or stale."
          : "AI-led profile is set but predictions remain disabled by override.";
    } else {
      modeLabel = "AI-led operations — waiting";
      overallTone = "amber";
      overallSummary =
        "AI-led profile is configured; waiting for fresh heartbeat, evidence, or recorded AI decisions.";
    }
  } else {
    modeLabel = "Safety-gated";
    overallTone = predictionsEnabled && lastDecisionRecent ? "amber" : "red";
    overallSummary = predictionsEnabled
      ? "Safety-gated profile with some capabilities manually enabled."
      : "Conservative safety-gated mode — advanced AI capabilities stay opt-in.";
  }

  const overallCapability: OpsStatusCapability = {
    id: "overall_mode",
    label: "Overall mode",
    tone: overallTone,
    summary: overallSummary,
    lastEvidenceAt: lastDecisionAt?.toISOString() ?? null,
    evidence: { profile, modeLabel }
  };


  const predictionNotificationsCapability: OpsStatusCapability = {
    id: "prediction_notifications",
    label: "Prediction notifications",
    tone: snapshotTone("predictionNotifications"),
    summary: areaSummary("predictionNotifications", "Prediction notifications policy unknown."),
    lastEvidenceAt: null,
    evidence: { area: areaById["predictionNotifications"] ?? null }
  };

  const preventiveCapability: OpsStatusCapability = {
    id: "preventive_recommendations",
    label: "Preventive recommendations",
    tone: snapshotTone("preventiveRecommendations"),
    summary: areaSummary("preventiveRecommendations", "Preventive recommendations policy unknown."),
    lastEvidenceAt: null,
    evidence: { area: areaById["preventiveRecommendations"] ?? null }
  };

  const recoveryCapability: OpsStatusCapability = {
    id: "recovery_verification",
    label: "Recovery verification",
    tone: snapshotTone("recoveryVerification"),
    summary: areaSummary("recoveryVerification", "Recovery verification policy unknown."),
    lastEvidenceAt: null,
    evidence: { area: areaById["recoveryVerification"] ?? null }
  };

  const topologyLearningCapability: OpsStatusCapability = {
    id: "topology_learning",
    label: "Topology learning",
    tone: snapshotTone("topologyLearning"),
    summary: areaSummary("topologyLearning", "Topology learning policy unknown."),
    lastEvidenceAt: null,
    evidence: { area: areaById["topologyLearning"] ?? null }
  };
  const capabilities = [
    overallCapability,
    predictionCapability,
    predictionNotificationsCapability,
    learningCapability,
    preventiveCapability,
    diagnosisCapability,
    healCapability,
    recoveryCapability,
    topologyLearningCapability,
    workerCapability,
    lastDecisionCapability
  ];

  const blocked: OpsStatusBlocked[] = capabilities
    .filter((c) => c.tone === "red" || (c.tone === "amber" && /waiting|no connected|Monitor Only|Emergency/i.test(c.summary)))
    .filter((c) => c.id !== "overall_mode" && c.id !== "last_ai_decision")
    .map((c) => ({
      id: c.id,
      label: c.label,
      reason: c.summary
    }));

  const recentDecisions: OpsStatusRecentDecision[] = [
    ...recentAudits.map((row) => ({
      id: row.id,
      kind: "audit" as const,
      summary: row.summary,
      decisionType: row.decisionType,
      confidence: row.confidenceScore,
      outcome: row.outcome,
      at: row.createdAt.toISOString()
    })),
    ...recentAutomations.map((row) => ({
      id: row.id,
      kind: "automation" as const,
      summary: row.reason ?? `Automation ${row.status}`,
      decisionType: row.triggerType,
      confidence: row.confidence,
      outcome: row.verificationStatus ?? row.status,
      at: row.createdAt.toISOString()
    })),
    ...recentPredictions.map((row) => ({
      id: row.id,
      kind: "prediction" as const,
      summary: row.title,
      decisionType: row.status,
      confidence: row.confidenceScore,
      outcome: row.reviewState,
      at: row.computedAt.toISOString()
    }))
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  return {
    asOf: now.toISOString(),
    overall: {
      modeLabel,
      tone: overallTone,
      summary: overallSummary
    },
    lastAiDecision: {
      at: lastDecisionAt?.toISOString() ?? null,
      summary: lastDecisionSummary,
      kind: lastDecisionKind
    },
    capabilities,
    blocked,
    recentDecisions
  };
};
