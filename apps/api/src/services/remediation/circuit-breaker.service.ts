import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { getUniversalAction } from "./action-registry";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

const projectKey = (projectId?: string | null) => projectId ?? "";

export const getCircuitState = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
}) => {
  const row = await prisma.remediationCircuitBreaker.findUnique({
    where: {
      organizationId_projectId_actionKey: {
        organizationId: input.organizationId,
        projectId: projectKey(input.projectId),
        actionKey: input.actionKey
      }
    }
  });
  if (!row) {
    return { state: "CLOSED" as CircuitBreakerState, openUntil: null as Date | null, reason: null as string | null };
  }
  if (row.state === "OPEN" && row.openUntil && row.openUntil.getTime() <= Date.now()) {
    await prisma.remediationCircuitBreaker.update({
      where: { id: row.id },
      data: { state: "HALF_OPEN", updatedAt: new Date() }
    });
    return { state: "HALF_OPEN" as CircuitBreakerState, openUntil: row.openUntil, reason: row.lastFailureReason };
  }
  return {
    state: row.state as CircuitBreakerState,
    openUntil: row.openUntil,
    reason: row.lastFailureReason
  };
};

export const assertCircuitClosed = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const state = await getCircuitState(input);
  if (state.state === "OPEN") {
    return {
      ok: false,
      reason: `Circuit breaker open for ${input.actionKey}${
        state.openUntil ? ` until ${state.openUntil.toISOString()}` : ""
      }${state.reason ? `: ${state.reason}` : ""}`
    };
  }
  return { ok: true };
};

const upsertBreaker = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
}) => {
  const projectId = projectKey(input.projectId);
  const existing = await prisma.remediationCircuitBreaker.findUnique({
    where: {
      organizationId_projectId_actionKey: {
        organizationId: input.organizationId,
        projectId,
        actionKey: input.actionKey
      }
    }
  });
  if (existing) return existing;
  return prisma.remediationCircuitBreaker.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId,
      actionKey: input.actionKey,
      state: "CLOSED",
      updatedAt: new Date()
    }
  });
};

export const recordCircuitFailure = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
  kind: "provider" | "verification" | "rollback";
  reason: string;
}) => {
  const def = getUniversalAction(input.actionKey);
  const policy = def?.circuitBreakerPolicy ?? {
    failureThreshold: 3,
    openMs: 15 * 60_000,
    includeVerificationFailures: true,
    includeRollbackFailures: true
  };

  const row = await upsertBreaker(input);
  const failureCount = row.failureCount + 1;
  const verificationFailures =
    row.verificationFailures + (input.kind === "verification" ? 1 : 0);
  const rollbackFailures = row.rollbackFailures + (input.kind === "rollback" ? 1 : 0);
  const providerErrors = row.providerErrors + (input.kind === "provider" ? 1 : 0);

  let towardOpen = providerErrors;
  if (policy.includeVerificationFailures) towardOpen += verificationFailures;
  if (policy.includeRollbackFailures) towardOpen += rollbackFailures;
  towardOpen = Math.max(towardOpen, failureCount);

  const shouldOpen = towardOpen >= policy.failureThreshold;
  const openUntil = shouldOpen ? new Date(Date.now() + policy.openMs) : row.openUntil;

  return prisma.remediationCircuitBreaker.update({
    where: { id: row.id },
    data: {
      failureCount,
      verificationFailures,
      rollbackFailures,
      providerErrors,
      lastFailureAt: new Date(),
      lastFailureReason: input.reason,
      state: shouldOpen ? "OPEN" : row.state === "HALF_OPEN" ? "OPEN" : row.state,
      openedAt: shouldOpen ? new Date() : row.openedAt,
      openUntil,
      updatedAt: new Date()
    }
  });
};

export const recordCircuitSuccess = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
}) => {
  const row = await prisma.remediationCircuitBreaker.findUnique({
    where: {
      organizationId_projectId_actionKey: {
        organizationId: input.organizationId,
        projectId: projectKey(input.projectId),
        actionKey: input.actionKey
      }
    }
  });
  if (!row) return null;
  return prisma.remediationCircuitBreaker.update({
    where: { id: row.id },
    data: {
      state: "CLOSED",
      failureCount: 0,
      verificationFailures: 0,
      rollbackFailures: 0,
      providerErrors: 0,
      openedAt: null,
      openUntil: null,
      lastFailureReason: null,
      updatedAt: new Date()
    }
  });
};

export const tripCircuitBreaker = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
  trippedBy: string;
  reason: string;
  openMs?: number;
}) => {
  const row = await upsertBreaker(input);
  const openMs = input.openMs ?? getUniversalAction(input.actionKey)?.circuitBreakerPolicy.openMs ?? 15 * 60_000;
  return prisma.remediationCircuitBreaker.update({
    where: { id: row.id },
    data: {
      state: "OPEN",
      openedAt: new Date(),
      openUntil: new Date(Date.now() + openMs),
      lastFailureReason: input.reason,
      trippedBy: input.trippedBy,
      updatedAt: new Date()
    }
  });
};

export const resetCircuitBreaker = async (input: {
  organizationId: string;
  projectId?: string | null;
  actionKey: string;
  resetBy: string;
}) => {
  const row = await upsertBreaker(input);
  return prisma.remediationCircuitBreaker.update({
    where: { id: row.id },
    data: {
      state: "CLOSED",
      failureCount: 0,
      verificationFailures: 0,
      rollbackFailures: 0,
      providerErrors: 0,
      openedAt: null,
      openUntil: null,
      lastFailureReason: null,
      resetBy: input.resetBy,
      resetAt: new Date(),
      updatedAt: new Date()
    }
  });
};
