/**
 * Typed 25-area AI & Automation policy document defaults.
 * Execution still flows through existing AutomationPolicy / auto-run / playbooks / gates.
 */

export type AiOperatingProfileId =
  | "MONITOR_ONLY"
  | "RECOMMEND"
  | "AI_LED_SAFE"
  | "FULL_AUTONOMOUS"
  | "EMERGENCY_PAUSE";

export type PolicyAreaState = {
  enabled: boolean;
  notes?: string;
  [key: string]: unknown;
};

export type AiAutomationPolicyDocument = {
  version: 1;
  areas: {
    operatingProfile: PolicyAreaState & { profile: AiOperatingProfileId };
    learningBaselines: PolicyAreaState;
    anomalyDetection: PolicyAreaState;
    incidentMatching: PolicyAreaState;
    predictions: PolicyAreaState & { minConfidence: number };
    predictionNotifications: PolicyAreaState;
    preventiveRecommendations: PolicyAreaState;
    advancedDiagnosis: PolicyAreaState;
    autonomousExecution: PolicyAreaState & {
      orgCeilingMode: string;
      safeAutoHeal: "automatic" | "approval" | "off";
      highImpact: "approval_required" | "autonomous_if_entitled";
    };
    actionPolicies: PolicyAreaState;
    playbookGovernance: PolicyAreaState;
    recoveryVerification: PolicyAreaState & { threshold: number; observationWindowMinutes: number };
    alertIncidentClosure: PolicyAreaState & { autoCloseAlerts: boolean; autoCloseIncidents: boolean };
    topologyLearning: PolicyAreaState;
    notificationsEscalation: PolicyAreaState & {
      critical: boolean;
      predictive: boolean;
      repair: boolean;
      recovery: boolean;
    };
    rolesApprovalsBreakGlass: PolicyAreaState & {
      breakGlassMaxMinutes: number;
      requireReason: boolean;
    };
    maintenanceSuppressionCooldowns: PolicyAreaState & {
      enforceMaintenance: boolean;
      enforceCooldowns: boolean;
    };
    securityCyberResponse: PolicyAreaState & { requireApproval: boolean };
    privacyRetentionResidency: PolicyAreaState & {
      auditRetentionDays: number;
      evidenceRetentionDays: number;
    };
    costUsageLimits: PolicyAreaState & {
      maxRepairAttemptsPerIncident: number;
      maxAiCallsPerHour: number | null;
    };
    connectorRemediatorPermissions: PolicyAreaState & { explicitAllowlistOnly: boolean };
    simulationReadiness: PolicyAreaState;
    modelLifecycleAccuracy: PolicyAreaState & {
      minAccuracy: number;
      suspendOnDrift: boolean;
    };
    policyVersionsOwnershipAudit: PolicyAreaState & { auditMandatory: boolean };
    resilienceDrPolicyHealth: PolicyAreaState & {
      failSafeStopRepairs: boolean;
    };
  };
};

export const defaultAiAutomationPolicyDocument = (
  profile: AiOperatingProfileId = "MONITOR_ONLY"
): AiAutomationPolicyDocument => {
  const on = profile === "AI_LED_SAFE" || profile === "FULL_AUTONOMOUS";
  const recommend = on || profile === "RECOMMEND";
  return {
    version: 1,
    areas: {
      operatingProfile: { enabled: true, profile },
      learningBaselines: { enabled: on || recommend },
      anomalyDetection: { enabled: on || recommend },
      incidentMatching: { enabled: on || recommend },
      predictions: { enabled: on, minConfidence: 0.85 },
      predictionNotifications: { enabled: on },
      preventiveRecommendations: { enabled: on },
      advancedDiagnosis: { enabled: on || recommend },
      autonomousExecution: {
        enabled: on,
        orgCeilingMode:
          profile === "FULL_AUTONOMOUS"
            ? "FULL_AUTONOMOUS"
            : profile === "AI_LED_SAFE"
              ? "AUTO_HEAL_SAFE"
              : profile === "RECOMMEND"
                ? "RECOMMEND"
                : "MONITOR_ONLY",
        safeAutoHeal: on ? "automatic" : "off",
        highImpact: "approval_required"
      },
      actionPolicies: { enabled: true },
      playbookGovernance: { enabled: true },
      recoveryVerification: {
        enabled: on || recommend,
        threshold: 2,
        observationWindowMinutes: 15
      },
      alertIncidentClosure: {
        enabled: on,
        autoCloseAlerts: on,
        autoCloseIncidents: on
      },
      topologyLearning: { enabled: on },
      notificationsEscalation: {
        enabled: true,
        critical: true,
        predictive: on,
        repair: on,
        recovery: on
      },
      rolesApprovalsBreakGlass: {
        enabled: true,
        breakGlassMaxMinutes: 60,
        requireReason: true
      },
      maintenanceSuppressionCooldowns: {
        enabled: true,
        enforceMaintenance: true,
        enforceCooldowns: true
      },
      securityCyberResponse: { enabled: true, requireApproval: true },
      privacyRetentionResidency: {
        enabled: true,
        auditRetentionDays: 365,
        evidenceRetentionDays: 90
      },
      costUsageLimits: {
        enabled: true,
        maxRepairAttemptsPerIncident: 3,
        maxAiCallsPerHour: null
      },
      connectorRemediatorPermissions: { enabled: true, explicitAllowlistOnly: true },
      simulationReadiness: { enabled: true },
      modelLifecycleAccuracy: { enabled: true, minAccuracy: 0.7, suspendOnDrift: true },
      policyVersionsOwnershipAudit: { enabled: true, auditMandatory: true },
      resilienceDrPolicyHealth: { enabled: true, failSafeStopRepairs: true }
    }
  };
};

export const POLICY_AREA_LABELS: Record<keyof AiAutomationPolicyDocument["areas"], string> = {
  operatingProfile: "AI operating profile",
  learningBaselines: "Learning and baselines",
  anomalyDetection: "Anomaly detection",
  incidentMatching: "Incident matching",
  predictions: "Predictions",
  predictionNotifications: "Prediction notifications",
  preventiveRecommendations: "Preventive recommendations",
  advancedDiagnosis: "Advanced diagnosis and root-cause analysis",
  autonomousExecution: "Autonomous execution",
  actionPolicies: "Action policies",
  playbookGovernance: "Playbook governance",
  recoveryVerification: "Recovery verification",
  alertIncidentClosure: "Alert and incident closure",
  topologyLearning: "Topology and dependency learning",
  notificationsEscalation: "Notifications and escalation",
  rolesApprovalsBreakGlass: "Roles, approvals and break-glass access",
  maintenanceSuppressionCooldowns: "Maintenance, suppression and cooldowns",
  securityCyberResponse: "Security and cyber response",
  privacyRetentionResidency: "Privacy, retention and data residency",
  costUsageLimits: "Cost and usage controls",
  connectorRemediatorPermissions: "Connector and remediator permissions",
  simulationReadiness: "Simulation and readiness assessment",
  modelLifecycleAccuracy: "Model lifecycle and accuracy governance",
  policyVersionsOwnershipAudit: "Policy versions, ownership and audit",
  resilienceDrPolicyHealth: "Resilience, disaster recovery and policy health"
};