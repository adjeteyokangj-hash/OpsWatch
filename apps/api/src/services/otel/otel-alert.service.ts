import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createAlert, resolveAlertsBySourceId } from "../alerting.service";
import { isOtelAlertGenerationEnabled } from "./otel-feature-flags";
import { evaluateOtelSignalPolicy, type OtelPolicyDecision } from "./otel-policy.service";
import type { NormalizedSignalDraft } from "./otel-normalize";

export const applyOtelPolicyAlert = async (input: {
  organizationId: string;
  projectId: string | null;
  batchId?: string | null;
  signalId?: string | null;
  draft: NormalizedSignalDraft;
  entityId?: string | null;
  relationshipId?: string | null;
  serviceId?: string | null;
  consecutiveHealthy?: number;
  isStale?: boolean;
}): Promise<{ alertId: string | null; decision: OtelPolicyDecision | null }> => {
  if (!isOtelAlertGenerationEnabled() || !input.projectId) {
    return { alertId: null, decision: null };
  }

  const decision = evaluateOtelSignalPolicy(input.draft, {
    consecutiveHealthy: input.consecutiveHealthy,
    isStale: input.isStale
  });
  if (!decision) return { alertId: null, decision: null };

  if (decision.shouldRecover && !decision.isStale) {
    await resolveAlertsBySourceId(input.projectId, "OTEL_POLICY", decision.sourceId);
    return { alertId: null, decision };
  }

  if (!decision.shouldAlert) {
    return { alertId: null, decision };
  }

  const result = await createAlert({
    projectId: input.projectId,
    serviceId: input.serviceId ?? undefined,
    sourceType: "OTEL_POLICY",
    sourceId: decision.sourceId,
    severity: decision.severity,
    category: decision.category,
    title: decision.title,
    message: decision.message,
    dedupeBySourceId: true
  });

  if (result.alertId) {
    await prisma.otelAlertEvidence.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        alertId: result.alertId,
        batchId: input.batchId ?? null,
        signalId: input.signalId ?? null,
        entityId: input.entityId ?? null,
        relationshipId: input.relationshipId ?? null,
        traceId: input.draft.traceId,
        spanId: input.draft.spanId,
        evidenceKind: decision.ruleId,
        summary: decision.message,
        confidence: decision.isStale ? 0.4 : 0.8,
        metadataJson: {
          fingerprint: decision.fingerprint,
          health: decision.health,
          signalType: input.draft.signalType
        } as Prisma.InputJsonValue,
        observedAt: input.draft.observedAt
      }
    });
  }

  return { alertId: result.alertId, decision };
};
