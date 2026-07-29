/**
 * Capability-driven readiness registry for AI & Automation Policies.
 * Remediation routes must be real pages in apps/web — never placeholder 404s.
 */

export type ReadinessCategory = "platform" | "application" | "ai";

export type ReadinessStatus = "full" | "not_configured" | "not_applicable" | "disabled";

export type ReadinessItemDefinition = {
  id: string;
  title: string;
  description: string;
  category: ReadinessCategory;
};

export const READINESS_ITEM_DEFINITIONS: readonly ReadinessItemDefinition[] = [
  {
    id: "discovery-successful",
    title: "Discovery successful",
    description: "External discovery document validated for this application.",
    category: "application"
  },
  {
    id: "authentication-verified",
    title: "Authentication verified",
    description: "Connection credentials authenticated and the application is Connected.",
    category: "application"
  },
  {
    id: "health-configured",
    title: "Health configured",
    description: "Advertised health capability has an active monitoring check.",
    category: "application"
  },
  {
    id: "monitoring-checks-active",
    title: "Monitoring checks active",
    description: "Active HTTP checks cover advertised discovery endpoints.",
    category: "application"
  },
  {
    id: "deployment-metadata",
    title: "Deployment metadata available",
    description: "Deployment/version capability is advertised and monitored when supported.",
    category: "application"
  },
  {
    id: "recent-heartbeat",
    title: "Recent heartbeat",
    description: "Optional push heartbeat within the last 20 minutes (Approach B).",
    category: "application"
  },
  {
    id: "notification-channel",
    title: "Notification channel configured",
    description: "At least one active notification channel for this organisation.",
    category: "platform"
  },
  {
    id: "remediator-integration",
    title: "Remediator integration configured",
    description: "A remediator or provider integration is enabled for this application.",
    category: "platform"
  },
  {
    id: "approved-playbook",
    title: "Approved playbook version",
    description: "An approved automation playbook version is available for AI-led execution.",
    category: "platform"
  },
  {
    id: "auto-run-approvals",
    title: "Auto-run approvals configured",
    description: "Auto-run allowlist and approvals are ready for autonomous actions.",
    category: "ai"
  },
  {
    id: "emergency-stop",
    title: "Emergency stop available",
    description: "Emergency stop can be applied on the selected application.",
    category: "ai"
  }
] as const;

export const resolveRemediationRoute = (
  itemId: string,
  projectId: string
): string | null => {
  switch (itemId) {
    case "discovery-successful":
    case "authentication-verified":
      return "/connections";
    case "health-configured":
    case "monitoring-checks-active":
      return `/projects/${projectId}/checks`;
    case "deployment-metadata":
      return `/projects/${projectId}/deployments`;
    case "recent-heartbeat":
      return `/projects/${projectId}`;
    case "notification-channel":
      return "/settings";
    case "remediator-integration":
      return `/projects/${projectId}/integrations`;
    case "approved-playbook":
      return "/automation/playbooks";
    case "auto-run-approvals":
      return "/auto-run-policy";
    case "emergency-stop":
      return `/projects/${projectId}/automation`;
    default:
      return null;
  }
};

/** Policy-area Fix links — only real web routes. */
export const POLICY_AREA_REMEDIATION_ROUTES: Record<string, string | null> = {
  operatingProfile: "/settings/ai-automation-policies",
  autonomousExecution: "/auto-run-policy",
  actionPolicies: "/auto-run-policy",
  playbookGovernance: "/automation/playbooks",
  simulationReadiness: "/settings/ai-automation-policies",
  modelLifecycleAccuracy: "/accuracy",
  notificationsEscalation: "/settings",
  connectorRemediatorPermissions: "/integrations",
  learningBaselines: "/intelligence",
  anomalyDetection: "/intelligence",
  incidentMatching: "/incidents",
  predictions: "/intelligence",
  recoveryVerification: "/checks",
  alertIncidentClosure: "/incidents",
  topologyLearning: null,
  predictionNotifications: "/settings",
  preventiveRecommendations: "/intelligence",
  advancedDiagnosis: "/intelligence",
  rolesApprovalsBreakGlass: "/auto-run-policy",
  maintenanceSuppressionCooldowns: "/settings/maintenance",
  securityCyberResponse: null,
  privacyRetentionResidency: null,
  costUsageLimits: null,
  policyVersionsOwnershipAudit: "/settings/ai-automation-policies",
  resilienceDrPolicyHealth: null
};

export const readinessStatusLabel = (status: ReadinessStatus): string => {
  switch (status) {
    case "full":
      return "Full";
    case "not_configured":
      return "Not configured";
    case "not_applicable":
      return "Not applicable";
    case "disabled":
      return "Disabled";
    default:
      return status;
  }
};

export const readinessStatusOk = (status: ReadinessStatus): boolean =>
  status === "full" || status === "not_applicable" || status === "disabled";
