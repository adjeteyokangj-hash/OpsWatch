import {
  REMEDIATION_REGISTRY,
  type ImpactTier,
  type RemediationAction
} from "./remediation/actions";
import { AUTO_RUN_ALLOWLIST, AUTO_RUN_COOLDOWN_MS } from "./remediation/auto-run-policy.service";

/**
 * Phase 7 — controlled automation gates.
 * High-impact actions stay blocked from autonomous execution by default.
 * Test mode validates and records results without mutating production systems.
 */

export type AutomationGateDecision = {
  allowed: boolean;
  mode: "EXECUTE" | "APPROVAL_REQUIRED" | "BLOCKED" | "TEST_ONLY";
  reason: string;
  impactTier: ImpactTier;
  requiresApproval: boolean;
  inAutoRunAllowlist: boolean;
  cooldownMs: number | null;
};

import { resolveEffectiveEnvFlag } from "./intelligence/ai-operating-profile.service";

export const isAutomationTestMode = (): boolean =>
  resolveEffectiveEnvFlag("OPSWATCH_AUTOMATION_TEST_MODE");

export const isAutoRepairEnabled = (): boolean =>
  resolveEffectiveEnvFlag("OPSWATCH_AUTO_REPAIR_ENABLED");

export const evaluateControlledAutomationGate = (
  action: RemediationAction,
  opts: { forceTestMode?: boolean } = {}
): AutomationGateDecision => {
  const def = REMEDIATION_REGISTRY[action];
  const testMode = opts.forceTestMode ?? isAutomationTestMode();
  const inAutoRunAllowlist = AUTO_RUN_ALLOWLIST.has(action);
  const cooldownMs = AUTO_RUN_COOLDOWN_MS[action] ?? null;

  if (testMode) {
    return {
      allowed: true,
      mode: "TEST_ONLY",
      reason: "Automation test mode: validate and record without mutating production systems",
      impactTier: def.impactTier,
      requiresApproval: def.requiresApproval,
      inAutoRunAllowlist,
      cooldownMs
    };
  }

  if (def.impactTier === "HIGH" && !isAutoRepairEnabled()) {
    return {
      allowed: false,
      mode: "BLOCKED",
      reason:
        "High-impact actions are blocked by default (set OPSWATCH_AUTO_REPAIR_ENABLED=true to permit approval-gated repair)",
      impactTier: def.impactTier,
      requiresApproval: true,
      inAutoRunAllowlist,
      cooldownMs
    };
  }

  if (def.requiresApproval || def.policyTier === "APPROVAL_REQUIRED") {
    return {
      allowed: false,
      mode: "APPROVAL_REQUIRED",
      reason: "Action requires explicit human approval before execution",
      impactTier: def.impactTier,
      requiresApproval: true,
      inAutoRunAllowlist,
      cooldownMs
    };
  }

  if (def.policyTier === "MANUAL_ONLY") {
    return {
      allowed: false,
      mode: "BLOCKED",
      reason: "Action is manual-only and cannot run autonomously",
      impactTier: def.impactTier,
      requiresApproval: false,
      inAutoRunAllowlist,
      cooldownMs
    };
  }

  if (!inAutoRunAllowlist) {
    return {
      allowed: false,
      mode: "BLOCKED",
      reason: "Action is outside the safe auto-run allowlist",
      impactTier: def.impactTier,
      requiresApproval: def.requiresApproval,
      inAutoRunAllowlist,
      cooldownMs
    };
  }

  return {
    allowed: true,
    mode: "EXECUTE",
    reason: "Low-impact allowlisted action may execute under existing org policy",
    impactTier: def.impactTier,
    requiresApproval: false,
    inAutoRunAllowlist,
    cooldownMs
  };
};

export type TestModeActionResult = {
  action: RemediationAction;
  wouldExecute: boolean;
  gate: AutomationGateDecision;
  simulatedOutcome: "WOULD_SUCCEED_VALIDATION" | "WOULD_REQUIRE_APPROVAL" | "WOULD_BLOCK";
  recordedAt: string;
};

export const runAutomationTestMode = (action: RemediationAction): TestModeActionResult => {
  const gate = evaluateControlledAutomationGate(action, { forceTestMode: true });
  const liveGate = evaluateControlledAutomationGate(action, { forceTestMode: false });
  let simulatedOutcome: TestModeActionResult["simulatedOutcome"] = "WOULD_SUCCEED_VALIDATION";
  if (liveGate.mode === "APPROVAL_REQUIRED") simulatedOutcome = "WOULD_REQUIRE_APPROVAL";
  if (liveGate.mode === "BLOCKED") simulatedOutcome = "WOULD_BLOCK";

  return {
    action,
    wouldExecute: liveGate.allowed && liveGate.mode === "EXECUTE",
    gate,
    simulatedOutcome,
    recordedAt: new Date().toISOString()
  };
};

export type ErrorBudgetSnapshot = {
  targetPct: number;
  availabilityPct: number | null;
  errorBudgetRemainingPct: number | null;
  burnRate: number | null;
  status: string;
  windowMinutes: number | null;
};

/** Derive error-budget remaining from SLO target + current availability window. */
export const computeErrorBudget = (input: {
  targetPct: number;
  availabilityPct: number | null;
  burnRate: number | null;
  status: string;
  windowMinutes?: number | null;
}): ErrorBudgetSnapshot => {
  if (input.availabilityPct == null) {
    return {
      targetPct: input.targetPct,
      availabilityPct: null,
      errorBudgetRemainingPct: null,
      burnRate: input.burnRate,
      status: input.status || "UNKNOWN",
      windowMinutes: input.windowMinutes ?? null
    };
  }
  const budgetTotal = Math.max(0, 100 - input.targetPct);
  const consumed = Math.max(0, input.targetPct - input.availabilityPct);
  const remaining =
    budgetTotal <= 0 ? 0 : Math.max(0, Math.min(100, ((budgetTotal - consumed) / budgetTotal) * 100));

  return {
    targetPct: input.targetPct,
    availabilityPct: input.availabilityPct,
    errorBudgetRemainingPct: Number(remaining.toFixed(2)),
    burnRate: input.burnRate,
    status: input.status,
    windowMinutes: input.windowMinutes ?? null
  };
};
