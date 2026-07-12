export type LayerImpactStatus = "ROOT_CAUSE" | "AFFECTED" | "DEGRADED" | "UNAFFECTED";
export type HealthLayer = "APP" | "MODULE" | "WORKFLOW" | "COMPONENT";
export type AppHealth = "HEALTHY" | "DEGRADED" | "DOWN";

export type LayerImpact = {
  layer: HealthLayer;
  serviceId: string;
  serviceName: string;
  status: LayerImpactStatus;
  rationale: string;
};

export type PropagationNode = {
  serviceId: string;
  serviceName: string;
  layer: HealthLayer;
  status: LayerImpactStatus;
};

export type DiagnosisResult = {
  diagnosis: string;
  confidence: number;
  category: string;
  failureClass?: string;
  possibleCauses?: string[];
  analysisMode?: "RULES" | "CORRELATION" | "LLM";
  rootCauseHypothesis?: string | null;
  evidence?: Array<{ type: string; summary: string; weight: number }>;
  topCandidates?: Array<{ kind: string; title: string; score: number; rationale: string }>;
  layerImpacts?: LayerImpact[];
  appHealth?: AppHealth;
  diagnosisReasons?: string[];
  dependencyImpact?: {
    narrative: string;
    appHealth?: AppHealth;
    probableRootCause?: { serviceId?: string; serviceName: string; layer: string } | null;
    propagationChain?: Array<{
      fromServiceId: string;
      fromServiceName: string;
      toServiceId: string;
      toServiceName: string;
      relationship: string;
    }>;
    propagationPath?: PropagationNode[];
  };
  suggestedActions: SuggestedAction[];
};

export type SuggestedAction = {
  action: string;
  label: string;
  description: string;
  group: "GROUP_A_SAFE" | "GROUP_B_APPROVAL" | "GROUP_C_SUPPORT";
  requiresApproval: boolean;
  kind: "fix" | "support";
  state: "READY" | "APPROVAL_REQUIRED" | "MISSING_CONTEXT" | "MISCONFIGURED_ENV" | "UNSUPPORTED";
  policyTier: "SAFE_AUTOMATIC" | "APPROVAL_REQUIRED" | "MANUAL_ONLY";
  confidenceScore: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";
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
};

export const layerLabel = (layer: HealthLayer): string => {
  if (layer === "APP") return "App";
  if (layer === "MODULE") return "Module";
  if (layer === "WORKFLOW") return "Workflow";
  return "Component";
};

export const statusLabel = (status: LayerImpactStatus | AppHealth): string => {
  if (status === "ROOT_CAUSE") return "Root cause";
  if (status === "AFFECTED") return "Affected";
  if (status === "DEGRADED") return "Degraded";
  if (status === "UNAFFECTED") return "Unaffected";
  if (status === "HEALTHY") return "Healthy";
  if (status === "DOWN") return "Down";
  return status;
};

export const serviceDetailHref = (serviceId: string, projectId?: string): string =>
  projectId
    ? `/checks?projectId=${projectId}&serviceId=${serviceId}`
    : `/checks?serviceId=${serviceId}`;
