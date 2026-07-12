import type { RemediationAction } from "../remediation/actions";
import { prisma } from "../../lib/prisma";

export type SafeguardScope = "ORGANIZATION" | "PLAYBOOK" | "INCIDENT" | "SERVICE";

export type SafeguardCheckResult = {
  allowed: boolean;
  reason: string;
  scope?: SafeguardScope;
};

type WindowLimit = { max: number; windowMs: number };

const readLimit = (envKey: string, fallback: WindowLimit): WindowLimit => {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const [maxRaw, minutesRaw] = raw.split(",");
  const max = Number(maxRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(max) || !Number.isFinite(minutes) || max <= 0 || minutes <= 0) {
    return fallback;
  }
  return { max, windowMs: minutes * 60_000 };
};

export const CIRCUIT_BREAKER_LIMITS: Partial<Record<RemediationAction | "AUTOMATION_RUN", WindowLimit>> = {
  RESTART_SERVICE: readLimit("CIRCUIT_RESTART_SERVICE", { max: 3, windowMs: 15 * 60_000 }),
  RESTART_WORKER: readLimit("CIRCUIT_RESTART_WORKER", { max: 3, windowMs: 15 * 60_000 }),
  REQUEUE_FAILED_JOB: readLimit("CIRCUIT_REQUEUE_JOB", { max: 5, windowMs: 15 * 60_000 }),
  AUTOMATION_RUN: readLimit("CIRCUIT_AUTOMATION_RUN", { max: 5, windowMs: 60 * 60_000 })
};

export const AUTOMATION_RATE_LIMITS = {
  plansPerOrgHour: Number(process.env.AUTOMATION_RATE_PLANS_PER_ORG_HOUR || 30),
  runsPerPlaybookHour: Number(process.env.AUTOMATION_RATE_RUNS_PER_PLAYBOOK_HOUR || 10),
  remediationsPerIncidentHour: Number(process.env.AUTOMATION_RATE_REMEDIATIONS_PER_INCIDENT_HOUR || 5),
  remediationsPerService15Min: Number(process.env.AUTOMATION_RATE_REMEDIATIONS_PER_SERVICE_15MIN || 3)
};

const countRemediationLogs = async (input: {
  organizationId: string;
  action?: string;
  incidentId?: string;
  serviceId?: string;
  since: Date;
}): Promise<number> =>
  prisma.remediationLog.count({
    where: {
      organizationId: input.organizationId,
      ...(input.action ? { action: input.action } : {}),
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      createdAt: { gte: input.since },
      status: { in: ["SUCCEEDED", "FAILED", "EXECUTING", "PENDING_APPROVAL"] }
    }
  });

export const checkCircuitBreaker = async (input: {
  organizationId: string;
  action: RemediationAction;
  incidentId?: string;
}): Promise<SafeguardCheckResult> => {
  const limit = CIRCUIT_BREAKER_LIMITS[input.action];
  if (!limit) return { allowed: true, reason: "No circuit breaker for action" };

  const since = new Date(Date.now() - limit.windowMs);
  const count = await countRemediationLogs({
    organizationId: input.organizationId,
    action: input.action,
    incidentId: input.incidentId,
    since
  });

  if (count >= limit.max) {
    return {
      allowed: false,
      reason: `Circuit breaker open: ${input.action} exceeded ${limit.max} executions in ${limit.windowMs / 60_000} minutes`,
      scope: input.incidentId ? "INCIDENT" : "ORGANIZATION"
    };
  }

  return { allowed: true, reason: "Circuit breaker closed" };
};

export const checkAutomationRateLimits = async (input: {
  organizationId: string;
  incidentId?: string;
  serviceId?: string;
  playbookKey?: string;
  phase: "PLAN" | "EXECUTE";
}): Promise<SafeguardCheckResult> => {
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);

  if (input.phase === "PLAN") {
    const planCount = await prisma.automationRun.count({
      where: { organizationId: input.organizationId, createdAt: { gte: hourAgo } }
    });
    if (planCount >= AUTOMATION_RATE_LIMITS.plansPerOrgHour) {
      return {
        allowed: false,
        reason: `Automation plan rate limit exceeded (${AUTOMATION_RATE_LIMITS.plansPerOrgHour}/hour per organization)`,
        scope: "ORGANIZATION"
      };
    }
  }

  if (input.playbookKey) {
    const playbookRuns = await prisma.automationRun.count({
      where: {
        organizationId: input.organizationId,
        createdAt: { gte: hourAgo },
        Version: { Playbook: { key: input.playbookKey } }
      }
    });
    if (playbookRuns >= AUTOMATION_RATE_LIMITS.runsPerPlaybookHour) {
      return {
        allowed: false,
        reason: `Playbook rate limit exceeded (${AUTOMATION_RATE_LIMITS.runsPerPlaybookHour}/hour for ${input.playbookKey})`,
        scope: "PLAYBOOK"
      };
    }
  }

  if (input.incidentId) {
    const incidentRemediations = await countRemediationLogs({
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      since: hourAgo
    });
    if (incidentRemediations >= AUTOMATION_RATE_LIMITS.remediationsPerIncidentHour) {
      return {
        allowed: false,
        reason: `Incident remediation rate limit exceeded (${AUTOMATION_RATE_LIMITS.remediationsPerIncidentHour}/hour)`,
        scope: "INCIDENT"
      };
    }

    const runLimit = CIRCUIT_BREAKER_LIMITS.AUTOMATION_RUN;
    if (runLimit) {
      const automationRuns = await prisma.automationRun.count({
        where: {
          organizationId: input.organizationId,
          incidentId: input.incidentId,
          createdAt: { gte: new Date(Date.now() - runLimit.windowMs) },
          status: { in: ["EXECUTING", "COMPLETED", "FAILED", "ROLLED_BACK", "APPROVED"] }
        }
      });
      if (automationRuns >= runLimit.max) {
        return {
          allowed: false,
          reason: `Automation run circuit breaker: ${runLimit.max} runs per incident per hour`,
          scope: "INCIDENT"
        };
      }
    }
  }

  if (input.serviceId) {
    const serviceRemediations = await countRemediationLogs({
      organizationId: input.organizationId,
      serviceId: input.serviceId,
      since: fifteenMinAgo
    });
    if (serviceRemediations >= AUTOMATION_RATE_LIMITS.remediationsPerService15Min) {
      return {
        allowed: false,
        reason: `Service remediation rate limit exceeded (${AUTOMATION_RATE_LIMITS.remediationsPerService15Min}/15min)`,
        scope: "SERVICE"
      };
    }
  }

  return { allowed: true, reason: "Within automation rate limits" };
};

export const AUTONOMOUS_PLAYBOOK_ACTIONS = new Set([
  "RERUN_CHECK",
  "VERIFY_SERVICE",
  "RETRY_WEBHOOKS",
  "RETRY_EMAILS",
  "REQUEUE_FAILED_JOB",
  "CHECK_PROVIDER_STATUS",
  "ACKNOWLEDGE_INCIDENT",
  "ADD_INCIDENT_NOTE",
  "REQUEST_HUMAN_REVIEW"
]);

export const isPlaybookAutonomousEligible = (steps: Array<{ action: string; approvalRequired: boolean }>): boolean =>
  steps.length > 0 &&
  steps.every((step) => AUTONOMOUS_PLAYBOOK_ACTIONS.has(step.action) && !step.approvalRequired);
