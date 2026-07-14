import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import type { ObservationSource, TimelineEventType } from "./intelligence-constants";
import { AI_DECISION_TYPE } from "./intelligence-constants";

export type RecordObservationInput = {
  organizationId: string;
  projectId?: string | null;
  sourceType: ObservationSource | string;
  sourceId?: string | null;
  eventKey: string;
  summary: string;
  severity?: string | null;
  payloadJson?: Record<string, unknown> | null;
  observedAt?: Date;
};

export const recordObservation = async (
  input: RecordObservationInput
): Promise<{ id: string }> => {
  const id = randomUUID();
  await prisma.operationalObservation.create({
    data: {
      id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      eventKey: input.eventKey,
      summary: input.summary,
      severity: input.severity ?? null,
      payloadJson: (input.payloadJson ?? undefined) as object | undefined,
      observedAt: input.observedAt ?? new Date()
    }
  });
  return { id };
};

export type RecordTimelineInput = {
  organizationId: string;
  projectId?: string | null;
  eventType: TimelineEventType | string;
  summary: string;
  sourceType?: string | null;
  sourceId?: string | null;
  severity?: string | null;
  payloadJson?: Record<string, unknown> | null;
  occurredAt?: Date;
};

export const recordOperationsTimelineEvent = async (
  input: RecordTimelineInput
): Promise<{ id: string }> => {
  const id = randomUUID();
  await prisma.operationsTimelineEvent.create({
    data: {
      id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      eventType: input.eventType,
      summary: input.summary,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      severity: input.severity ?? null,
      payloadJson: (input.payloadJson ?? undefined) as object | undefined,
      occurredAt: input.occurredAt ?? new Date()
    }
  });
  return { id };
};

export type RecordAiAuditInput = {
  organizationId: string;
  actorUserId?: string | null;
  decisionType: (typeof AI_DECISION_TYPE)[keyof typeof AI_DECISION_TYPE] | string;
  subjectType: string;
  subjectId?: string | null;
  summary: string;
  confidenceScore?: number | null;
  evidenceJson?: Record<string, unknown> | null;
  outcome?: string | null;
};

export const recordAiDecisionAudit = async (
  input: RecordAiAuditInput
): Promise<{ id: string }> => {
  const id = randomUUID();
  await prisma.aiDecisionAudit.create({
    data: {
      id,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      decisionType: input.decisionType,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      summary: input.summary,
      confidenceScore: input.confidenceScore ?? null,
      evidenceJson: (input.evidenceJson ?? undefined) as object | undefined,
      outcome: input.outcome ?? null
    }
  });
  return { id };
};
