import { prisma } from "../../lib/prisma";
import {
  analyzeIncidentDeep,
  type DeepDiagnosisResult,
  type IncidentAnalysisContext
} from "../ai/incident-analysis.service";
import { diagnose } from "../ai/incident-ai.service";
import {
  getActionState,
  REMEDIATION_REGISTRY,
  type RemediationAction,
  scoreActionConfidence,
  type ActionState,
  type ConfidenceLabel
} from "./actions";
import {
  checkAutoRunPolicy,
  checkCooldown,
  checkSuppressionGuard,
  isActionAllowedByPolicy
} from "./auto-run-policy.service";
import { listIncidentRootCauseCandidates, listIncidentTimeline } from "../incidents.service";
import type { RemediationContext } from "./types";

export interface EnrichedSuggestedAction {
  action: RemediationAction;
  label: string;
  description: string;
  group: "GROUP_A_SAFE" | "GROUP_B_APPROVAL" | "GROUP_C_SUPPORT";
  requiresApproval: boolean;
  kind: "fix" | "support";
  state: ActionState;
  policyTier: "SAFE_AUTOMATIC" | "APPROVAL_REQUIRED" | "MANUAL_ONLY";
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  confidenceFactors: Array<{
    name: string;
    impact: number;
    description: string;
    status: "pass" | "warn" | "fail";
  }>;
  historicalSuccessRate: number | null;
  autoRunEligible: boolean;
  impactTier: "LOW" | "MEDIUM" | "HIGH";
  suppressionInfo: {
    suppressed: boolean;
    blocked: boolean;
    recentFailureRate: number;
    recentFailed: number;
    windowSize: number;
    reason: string;
  } | null;
  missingFields?: string[];
  missingEnvVars?: string[];
  preview?: Record<string, unknown>;
}

export interface IncidentDiagnosisResponse extends Omit<DeepDiagnosisResult, "suggestedActions"> {
  suggestedActions: EnrichedSuggestedAction[];
}

const autoRunMinScore = (): number => {
  const raw = Number(process.env.AUTO_RUN_MIN_CONFIDENCE_SCORE || 70);
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 70;
};

export const loadAnalysisContext = async (
  organizationId: string,
  incidentId: string
): Promise<IncidentAnalysisContext | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    include: {
      Project: { select: { id: true, name: true } },
      IncidentAlert: {
        include: {
          Alert: {
            select: {
              id: true,
              title: true,
              message: true,
              severity: true,
              status: true,
              sourceType: true,
              category: true,
              serviceId: true,
              sourceId: true
            }
          }
        }
      }
    }
  });
  if (!incident) return null;

  const [timeline, candidates, services, dependencyEdges, openProjectAlerts, checkResults] = await Promise.all([
    listIncidentTimeline(organizationId, incidentId, 50),
    listIncidentRootCauseCandidates(organizationId, incidentId),
    prisma.service.findMany({
      where: { projectId: incident.projectId },
      select: { id: true, name: true, type: true, status: true }
    }),
    prisma.serviceDependency.findMany({
      where: { projectId: incident.projectId, isActive: true },
      select: {
        fromServiceId: true,
        toServiceId: true,
        dependencyType: true,
        criticality: true
      }
    }),
    prisma.alert.findMany({
      where: { projectId: incident.projectId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { serviceId: true, sourceId: true, sourceType: true, message: true, id: true }
    }),
    prisma.checkResult.findMany({
      where: {
        Check: {
          serviceId: {
            in: incident.IncidentAlert.map((ref) => ref.Alert.serviceId).filter((value): value is string => Boolean(value))
          }
        }
      },
      orderBy: { checkedAt: "desc" },
      take: 20,
      include: { Check: { select: { id: true } } }
    })
  ]);

  const sloRows = await prisma.sLODefinition.findMany({
    where: { projectId: incident.projectId, enabled: true, archivedAt: null },
    include: {
      SLOWindow: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    take: 20
  });

  const sloBreaches = sloRows
    .filter((row) => row.SLOWindow[0] && row.SLOWindow[0].status !== "HEALTHY")
    .map((row) => ({
      name: row.name,
      status: row.SLOWindow[0]!.status,
      burnRate: row.SLOWindow[0]!.burnRate
    }));

  const checkFailures = incident.IncidentAlert.map((ref) => {
    const latest = checkResults.find((row) => row.Check.id === ref.Alert.sourceId);
    const raw = (latest?.rawJson as Record<string, unknown> | null) ?? null;
    return {
      alertId: ref.Alert.id,
      checkId: ref.Alert.sourceId ?? undefined,
      failureClass: typeof raw?.failureClass === "string" ? raw.failureClass : undefined,
      expectedStatusCode:
        typeof raw?.expectedStatusCode === "number" ? raw.expectedStatusCode : undefined,
      actualStatusCode: typeof raw?.actualStatusCode === "number" ? raw.actualStatusCode : latest?.responseCode ?? undefined,
      message: ref.Alert.message
    };
  });

  const failingServiceIds = [
    ...new Set(
      openProjectAlerts
        .map((row) => row.serviceId)
        .filter((value): value is string => Boolean(value))
    )
  ];

  return {
    incidentId: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    projectId: incident.projectId,
    projectName: incident.Project.name,
    openedAt: incident.openedAt,
    alerts: incident.IncidentAlert.map((ref) => ref.Alert),
    timeline: (timeline ?? []).map((row) => ({
      eventType: row.eventType,
      summary: row.summary,
      occurredAt: new Date(row.occurredAt),
      sourceType: row.sourceType
    })),
    candidates: candidates ?? [],
    sloBreaches,
    services,
    dependencyEdges,
    failingServiceIds,
    checkFailures
  };
};

const buildRemediationContext = (
  organizationId: string,
  context: IncidentAnalysisContext
): RemediationContext => {
  const leadAlert = context.alerts[0];
  const leadFailure = context.checkFailures[0];
  return {
    organizationId,
    projectId: context.projectId,
    incidentId: context.incidentId,
    alertId: leadAlert?.id,
    serviceId: leadAlert?.serviceId ?? undefined,
    checkId:
      leadAlert?.sourceType === "CHECK" && leadAlert.sourceId
        ? leadAlert.sourceId
        : leadFailure?.checkId,
    extra: {
      severity: context.severity,
      expectedStatusCode: leadFailure?.expectedStatusCode,
      actualStatusCode: leadFailure?.actualStatusCode,
      failureClass: leadFailure?.failureClass ?? diagnosisFailureClassFromContext(context)
    }
  };
};

const diagnosisFailureClassFromContext = (context: IncidentAnalysisContext): string | undefined =>
  context.checkFailures[0]?.failureClass;

const loadHttpStatusPreview = async (
  remediationContext: RemediationContext
): Promise<Record<string, unknown> | undefined> => {
  if (!remediationContext.serviceId && !remediationContext.checkId) return undefined;
  const check = await prisma.check.findFirst({
    where: {
      isActive: true,
      type: "HTTP",
      ...(remediationContext.checkId ? { id: remediationContext.checkId } : {}),
      ...(remediationContext.serviceId ? { serviceId: remediationContext.serviceId } : {})
    },
    include: { Service: { select: { name: true } } },
    orderBy: { updatedAt: "desc" }
  });
  if (!check) return undefined;

  const recentResults = await prisma.checkResult.findMany({
    where: { checkId: check.id },
    orderBy: { checkedAt: "desc" },
    take: 8,
    select: {
      status: true,
      responseCode: true,
      message: true,
      checkedAt: true
    }
  });

  const actualStatusCode =
    typeof remediationContext.extra?.actualStatusCode === "number"
      ? remediationContext.extra.actualStatusCode
      : recentResults.find((row) => row.status === "FAIL")?.responseCode ??
        recentResults[0]?.responseCode ??
        null;

  return {
    checkId: check.id,
    checkName: check.name,
    serviceName: check.Service.name,
    currentExpectedStatus: check.expectedStatusCode,
    recentActualStatus: actualStatusCode,
    proposedExpectedStatus: actualStatusCode,
    recentResults: recentResults.map((row) => ({
      status: row.status,
      responseCode: row.responseCode,
      message: row.message,
      checkedAt: row.checkedAt.toISOString()
    })),
    riskExplanation:
      "Changing the expected HTTP status alters monitoring policy and can hide genuine deployment or configuration regressions. Only approve when the endpoint is intentionally healthy at the received status."
  };
};

const enrichAction = async (
  action: RemediationAction,
  remediationContext: RemediationContext,
  diagnosisConfidence: number,
  diagnosisFailureClass?: string
): Promise<EnrichedSuggestedAction> => {
  const def = REMEDIATION_REGISTRY[action];
  const projectIntegrations = remediationContext.projectId
    ? await prisma.projectIntegration.findMany({
        where: { projectId: remediationContext.projectId, enabled: true },
        select: { type: true, enabled: true, configJson: true, validationStatus: true, lastValidatedAt: true }
      })
    : [];

  const normalizedIntegrations = projectIntegrations.map((row) => ({
    type: row.type,
    enabled: row.enabled,
    configJson: (row.configJson as Record<string, unknown> | null) ?? null,
    validationStatus: row.validationStatus,
    lastValidatedAt: row.lastValidatedAt
  }));

  const [succeeded, failed] = await Promise.all([
    prisma.remediationLog.count({
      where: { organizationId: remediationContext.organizationId, action, status: "SUCCEEDED" }
    }),
    prisma.remediationLog.count({
      where: { organizationId: remediationContext.organizationId, action, status: "FAILED" }
    })
  ]);
  const total = succeeded + failed;
  const historicalSuccessRate = total > 0 ? succeeded / total : null;

  const state = getActionState(action, remediationContext, normalizedIntegrations);
  const requiredType = def.requiredIntegration?.type;
  const requiredIntegration = requiredType
    ? projectIntegrations.find((row) => row.type === requiredType)
    : undefined;

  const confidence = scoreActionConfidence({
    action,
    state,
    severity: remediationContext.extra?.severity as string | undefined,
    integrationValidationStatus: requiredIntegration?.validationStatus,
    lastValidatedAt: requiredIntegration?.lastValidatedAt,
    historicalSuccessRate
  });

  const policy = await checkAutoRunPolicy(
    remediationContext.organizationId,
    action,
    remediationContext.projectId
  );
  const cooldown = await checkCooldown(
    remediationContext.organizationId,
    action,
    remediationContext.incidentId,
    remediationContext.serviceId
  );
  const suppression = await checkSuppressionGuard(remediationContext.organizationId, action);

  const policyAllowed = isActionAllowedByPolicy({ action, policyCheck: policy });
  const minScore = autoRunMinScore();
  const autoRunEligible =
    def.policyTier === "SAFE_AUTOMATIC" &&
    state === "READY" &&
    policyAllowed &&
    cooldown.cooledDown &&
    !suppression.suppressed &&
    confidence.confidenceScore >= minScore &&
    diagnosisConfidence >= 0.55 &&
    !(action === "RERUN_HTTP_CHECK" && diagnosisFailureClass === "HTTP_STATUS_MISMATCH") &&
    action !== "REVIEW_HTTP_EXPECTED_STATUS";

  const preview =
    action === "REVIEW_HTTP_EXPECTED_STATUS"
      ? await loadHttpStatusPreview(remediationContext)
      : undefined;

  return {
    action,
    label: def.label,
    description: def.description,
    group: def.group,
    requiresApproval: def.requiresApproval,
    kind: def.kind,
    state,
    policyTier: def.policyTier,
    confidenceScore: confidence.confidenceScore,
    confidenceLabel: confidence.confidenceLabel,
    confidenceFactors: confidence.factors,
    historicalSuccessRate,
    autoRunEligible,
    impactTier: def.impactTier,
    preview,
    suppressionInfo: suppression.recentFailureRate == null
      ? null
      : {
          suppressed: suppression.suppressed,
          blocked: suppression.suppressed,
          recentFailureRate: suppression.recentFailureRate,
          recentFailed: suppression.recentFailed,
          windowSize: suppression.windowSize,
          reason: suppression.reason ?? ""
        }
  };
};

export const buildIncidentDiagnosis = async (
  organizationId: string,
  input: {
    incidentId?: string;
    alertType?: string;
    eventTypes?: string[];
    severity?: string;
    title?: string;
    message?: string;
  }
): Promise<IncidentDiagnosisResponse> => {
  if (input.incidentId) {
    const context = await loadAnalysisContext(organizationId, input.incidentId);
    if (!context) {
      throw new Error("Incident not found");
    }

    const deep = await analyzeIncidentDeep(context);
    const remediationContext = buildRemediationContext(organizationId, context);
    const enriched = await Promise.all(
      deep.suggestedActions.map((action) =>
        enrichAction(action, remediationContext, deep.confidence, deep.failureClass)
      )
    );

    return { ...deep, suggestedActions: enriched };
  }

  const shallow = diagnose({
    alertType: input.alertType,
    eventTypes: input.eventTypes,
    severity: input.severity,
    title: input.title,
    message: input.message
  });

  const remediationContext: RemediationContext = {
    organizationId,
    extra: { severity: input.severity }
  };

  const enriched = await Promise.all(
    shallow.suggestedActions.map((action) =>
      enrichAction(action, remediationContext, shallow.confidence, shallow.failureClass)
    )
  );

  return {
    ...shallow,
    analysisMode: "RULES",
    rootCauseHypothesis: null,
    evidence: [],
    topCandidates: [],
    suggestedActions: enriched
  };
};
