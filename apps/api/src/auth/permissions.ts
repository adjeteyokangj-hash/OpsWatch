import type { RemediationAction } from "../services/remediation/actions";
import { REMEDIATION_REGISTRY } from "../services/remediation/actions";

export type OpsWatchRole =
  | "VIEWER"
  | "INCIDENT_RESPONDER"
  | "AUTOMATION_OPERATOR"
  | "ADMIN";

export type Permission =
  | "incidents:read"
  | "diagnosis:read"
  | "remediation:execute:safe"
  | "remediation:execute:approval"
  | "remediation:auto_heal"
  | "remediation:approve"
  | "automation:plan:observe"
  | "automation:plan:approve"
  | "automation:execute"
  | "policy:manage"
  | "maintenance:view"
  | "maintenance:manage"
  | "playbooks:view"
  | "playbooks:manage"
  | "analytics:view";

const ROLE_PERMISSIONS: Record<OpsWatchRole, ReadonlySet<Permission>> = {
  VIEWER: new Set([
    "incidents:read",
    "diagnosis:read",
    "automation:plan:observe",
    "maintenance:view",
    "playbooks:view",
    "analytics:view"
  ]),
  INCIDENT_RESPONDER: new Set([
    "incidents:read",
    "diagnosis:read",
    "remediation:execute:safe",
    "automation:plan:observe",
    "maintenance:view",
    "playbooks:view",
    "analytics:view"
  ]),
  AUTOMATION_OPERATOR: new Set([
    "incidents:read",
    "diagnosis:read",
    "remediation:execute:safe",
    "remediation:execute:approval",
    "remediation:auto_heal",
    "remediation:approve",
    "automation:plan:observe",
    "automation:plan:approve",
    "automation:execute",
    "maintenance:view",
    "playbooks:view",
    "analytics:view"
  ]),
  ADMIN: new Set([
    "incidents:read",
    "diagnosis:read",
    "remediation:execute:safe",
    "remediation:execute:approval",
    "remediation:auto_heal",
    "remediation:approve",
    "automation:plan:observe",
    "automation:plan:approve",
    "automation:execute",
    "policy:manage",
    "maintenance:view",
    "maintenance:manage",
    "playbooks:view",
    "playbooks:manage",
    "analytics:view"
  ])
};

const SAFE_AUTONOMOUS_ACTIONS = new Set<RemediationAction>([
  "RERUN_HTTP_CHECK",
  "RERUN_SSL_CHECK",
  "RETRY_WEBHOOKS",
  "RETRY_EMAILS",
  "REQUEUE_FAILED_JOB",
  "CHECK_PROVIDER_STATUS",
  "ACKNOWLEDGE_INCIDENT",
  "ADD_INCIDENT_NOTE",
  "REQUEST_HUMAN_REVIEW"
]);

export const normalizeRole = (role: string | undefined): OpsWatchRole => {
  if (!role) return "VIEWER";
  if (role === "MEMBER") return "INCIDENT_RESPONDER";
  if (role === "ADMIN") return "ADMIN";
  if (role in ROLE_PERMISSIONS) return role as OpsWatchRole;
  return "VIEWER";
};

export const hasPermission = (role: string | undefined, permission: Permission): boolean =>
  ROLE_PERMISSIONS[normalizeRole(role)].has(permission);

export const canExecuteRemediationAction = (
  role: string | undefined,
  action: RemediationAction,
  approved: boolean
): boolean => {
  const normalized = normalizeRole(role);
  const def = REMEDIATION_REGISTRY[action];
  if (!def) return false;

  if (def.requiresApproval || def.policyTier === "APPROVAL_REQUIRED") {
    return hasPermission(normalized, "remediation:execute:approval") && approved;
  }

  if (SAFE_AUTONOMOUS_ACTIONS.has(action)) {
    return hasPermission(normalized, "remediation:execute:safe");
  }

  return hasPermission(normalized, "remediation:execute:approval");
};

export const canTriggerAutoHeal = (role: string | undefined): boolean =>
  hasPermission(role, "remediation:auto_heal");
