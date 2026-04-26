/**
 * Phase 9 — Auto-Remediation Policy Service
 *
 * Implements a three-level policy hierarchy:
 *   GLOBAL  → org-wide on/off switch
 *   PROJECT → per-project on/off switch
 *   ACTION  → per-action on/off switch
 *
 * Resolution order (most specific wins):
 *   1. ACTION policy for that action key   (if set, use it)
 *   2. PROJECT policy for the project      (if set, use it)
 *   3. GLOBAL policy                       (if set, use it)
 *   4. Default → DISABLED
 *
 * Safe-action allowlist: only actions on this list are ever eligible for
 * automatic execution regardless of policy settings.
 */

import { prisma } from "../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationAction } from "./actions";

// ── Safe-action allowlist (Phase 9.5) ───────────────────────────────────────
// Only these low-risk, idempotent actions may run automatically.
// All others must remain MANUAL or APPROVAL_REQUIRED.
export const AUTO_RUN_ALLOWLIST = new Set<RemediationAction>([
  "RERUN_HTTP_CHECK",
  "RERUN_SSL_CHECK",
  "RETRY_WEBHOOKS",
  "CHECK_PROVIDER_STATUS",
]);

// ── Cooldown windows per action in milliseconds (Phase 9.4) ─────────────────
export const AUTO_RUN_COOLDOWN_MS: Partial<Record<RemediationAction, number>> = {
  RERUN_HTTP_CHECK:       5 * 60 * 1000,  // 5 min
  RERUN_SSL_CHECK:        5 * 60 * 1000,  // 5 min
  RETRY_WEBHOOKS:        10 * 60 * 1000,  // 10 min
  CHECK_PROVIDER_STATUS:  5 * 60 * 1000,  // 5 min
};

// ── Policy resolution ────────────────────────────────────────────────────────

export interface PolicyCheckResult {
  allowed: boolean;
  /** Which level of the hierarchy made the decision */
  level: "ACTION" | "PROJECT" | "GLOBAL" | "DEFAULT";
  /** Human-readable reason for operators / audit */
  reason: string;
  /** Whether the action is in the allowlist at all */
  inAllowlist: boolean;
}

export type AutoRunPolicySnapshot = {
  enabled: boolean;
  allowedActionKeys: string[];
  cooldownMinutes: number;
  level?: "ACTION" | "PROJECT" | "GLOBAL" | "DEFAULT";
  reason?: string;
};

export async function checkAutoRunPolicy(
  organizationId: string,
  action: RemediationAction,
  projectId?: string
): Promise<PolicyCheckResult> {
  // Allowlist is a hard gate — no policy can override it
  if (!AUTO_RUN_ALLOWLIST.has(action)) {
    return {
      allowed: false,
      level: "DEFAULT",
      reason: `Action ${action} is not in the auto-run allowlist`,
      inAllowlist: false,
    };
  }

  // Fetch all relevant policy rows in one query
  const keys = [
    { policyType: "ACTION",  policyKey: action },
    ...(projectId ? [{ policyType: "PROJECT", policyKey: projectId }] : []),
    { policyType: "GLOBAL",  policyKey: "" },
  ];

  const rows = await prisma.autoRemediationPolicy.findMany({
    where: {
      organizationId,
      OR: keys,
    },
  });

  const byType = (type: string, key: string) =>
    rows.find((r) => r.policyType === type && r.policyKey === key);

  // Resolution: ACTION > PROJECT > GLOBAL > default-disabled
  const actionRow  = byType("ACTION",  action);
  const projectRow = projectId ? byType("PROJECT", projectId) : undefined;
  const globalRow  = byType("GLOBAL",  "");

  if (actionRow) {
    return {
      allowed: actionRow.enabled,
      level: "ACTION",
      reason: actionRow.enabled
        ? `Action policy explicitly enabled for ${action}`
        : `Action policy explicitly disabled for ${action}`,
      inAllowlist: true,
    };
  }

  if (projectRow) {
    return {
      allowed: projectRow.enabled,
      level: "PROJECT",
      reason: projectRow.enabled
        ? `Project auto-remediation enabled`
        : `Project auto-remediation disabled`,
      inAllowlist: true,
    };
  }

  if (globalRow) {
    return {
      allowed: globalRow.enabled,
      level: "GLOBAL",
      reason: globalRow.enabled
        ? `Global auto-remediation enabled`
        : `Global auto-remediation disabled`,
      inAllowlist: true,
    };
  }

  // Safe default: disabled
  return {
    allowed: false,
    level: "DEFAULT",
    reason: "No policy configured — auto-remediation disabled by default",
    inAllowlist: true,
  };
}

// ── Upsert a policy setting ──────────────────────────────────────────────────

export async function upsertPolicy(
  organizationId: string,
  policyType: "GLOBAL" | "PROJECT" | "ACTION",
  policyKey: string,
  enabled: boolean,
  updatedBy?: string
): Promise<void> {
  await prisma.autoRemediationPolicy.upsert({
    where: {
      organizationId_policyType_policyKey: {
        organizationId,
        policyType,
        policyKey,
      },
    },
    create: { id: randomUUID(), organizationId, policyType, policyKey, enabled, updatedBy, updatedAt: new Date() },
    update: { enabled, updatedBy, updatedAt: new Date() },
  });
}

// ── List all policies for an org ─────────────────────────────────────────────

export async function listPolicies(organizationId: string) {
  return prisma.autoRemediationPolicy.findMany({
    where: { organizationId },
    orderBy: [{ policyType: "asc" }, { policyKey: "asc" }],
  });
}

export async function getAutoRunPolicy(organizationId: string) {
  const policies = await listPolicies(organizationId);
  const global = policies.find((p) => p.policyType === "GLOBAL" && p.policyKey === "");
  const enabled = global?.enabled ?? false;

  const allowedActionKeys = Array.from(AUTO_RUN_ALLOWLIST).filter((action) => {
    const actionOverride = policies.find((p) => p.policyType === "ACTION" && p.policyKey === action);
    return actionOverride ? actionOverride.enabled : true;
  });

  const cooldownMinutes = 5;

  return {
    enabled,
    allowedActionKeys,
    cooldownMinutes,
    policies,
  };
}

export async function updateAutoRunPolicy(input: {
  organizationId: string;
  policyType: "GLOBAL" | "PROJECT" | "ACTION";
  policyKey: string;
  enabled: boolean;
  updatedBy?: string;
}): Promise<void> {
  await upsertPolicy(
    input.organizationId,
    input.policyType,
    input.policyKey,
    input.enabled,
    input.updatedBy
  );
}

export function isActionAllowedByPolicy(input: {
  action: RemediationAction;
  policyCheck: PolicyCheckResult;
}): boolean {
  return AUTO_RUN_ALLOWLIST.has(input.action) && input.policyCheck.allowed;
}

export function buildPolicySnapshot(policy: {
  enabled: boolean;
  allowedActionKeys: string[];
  cooldownMinutes: number;
  level?: "ACTION" | "PROJECT" | "GLOBAL" | "DEFAULT";
  reason?: string;
}): AutoRunPolicySnapshot {
  return {
    enabled: policy.enabled,
    allowedActionKeys: policy.allowedActionKeys,
    cooldownMinutes: policy.cooldownMinutes,
    level: policy.level,
    reason: policy.reason,
  };
}

// ── Cooldown check (Phase 9.4) ───────────────────────────────────────────────

export interface CooldownCheckResult {
  cooledDown: boolean;
  /** When the cooldown expires (if still active) */
  expiresAt?: Date;
  /** The last automatic run that triggered cooldown */
  lastAutoRunAt?: Date;
}

export interface SuppressionGuardResult {
  suppressed: boolean;
  recentFailureRate: number | null;
  recentFailed: number;
  windowSize: number;
  reason: string | null;
}

export async function checkCooldown(
  organizationId: string,
  action: RemediationAction,
  incidentId?: string,
  serviceId?: string
): Promise<CooldownCheckResult> {
  const windowMs = AUTO_RUN_COOLDOWN_MS[action] ?? 5 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  const lastRun = await prisma.remediationLog.findFirst({
    where: {
      organizationId,
      action,
      executionMode: "AUTOMATIC",
      createdAt: { gte: since },
      ...(incidentId ? { incidentId } : {}),
      ...(serviceId  ? { serviceId  } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!lastRun) {
    return { cooledDown: true };
  }

  const expiresAt = new Date(lastRun.createdAt.getTime() + windowMs);
  return {
    cooledDown: false,
    expiresAt,
    lastAutoRunAt: lastRun.createdAt,
  };
}

export async function checkSuppressionGuard(
  organizationId: string,
  action: RemediationAction,
  threshold = 0.25,
  minSamples = 5
): Promise<SuppressionGuardResult> {
  const last20 = await prisma.remediationLog.findMany({
    where: {
      organizationId,
      action,
      status: { in: ["SUCCEEDED", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { status: true },
  });

  const recentFailed = last20.filter((l) => l.status === "FAILED").length;
  const recentFailureRate = last20.length >= minSamples ? recentFailed / last20.length : null;
  const suppressed = recentFailureRate !== null && recentFailureRate > threshold;

  return {
    suppressed,
    recentFailureRate,
    recentFailed,
    windowSize: last20.length,
    reason: suppressed
      ? `Suppressed at ${Math.round((recentFailureRate ?? 0) * 100)}% failures over last ${last20.length} runs`
      : null,
  };
}
