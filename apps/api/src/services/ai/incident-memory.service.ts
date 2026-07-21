import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { IncidentAnalysisContext } from "./incident-analysis.service";

export type SimilarIncidentMatch = {
  incidentId: string;
  title: string;
  category: string | null;
  diagnosisSummary: string;
  rootCause: string | null;
  resolutionSummary: string | null;
  similarity: number;
  resolvedAt: string | null;
};

const tokenize = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

export const buildIncidentSignatureText = (input: {
  title: string;
  category?: string | null;
  diagnosisSummary: string;
  rootCause?: string | null;
  alerts?: Array<{ title: string; message: string; sourceType: string }>;
  timeline?: Array<{ eventType: string; summary: string }>;
}): string => {
  const alertText = (input.alerts ?? [])
    .slice(0, 6)
    .map((row) => `${row.sourceType} ${row.title} ${row.message}`)
    .join(" ");
  const timelineText = (input.timeline ?? [])
    .slice(0, 6)
    .map((row) => `${row.eventType} ${row.summary}`)
    .join(" ");

  return [
    input.title,
    input.category ?? "",
    input.diagnosisSummary,
    input.rootCause ?? "",
    alertText,
    timelineText
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const embedText = async (text: string): Promise<number[] | null> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const enabled = process.env.INCIDENT_AI_LLM_ENABLED === "true";
  if (!enabled || !apiKey) return null;

  const model = process.env.INCIDENT_AI_EMBEDDING_MODEL || "text-embedding-3-small";
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) })
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    return payload.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
};

export const indexIncidentMemory = async (input: {
  organizationId: string;
  incidentId: string;
  projectId?: string | null;
  title: string;
  category?: string | null;
  diagnosisSummary: string;
  rootCause?: string | null;
  resolutionSummary?: string | null;
  resolvedAt?: Date | null;
  alerts?: Array<{ title: string; message: string; sourceType: string }>;
  timeline?: Array<{ eventType: string; summary: string }>;
  affectedServiceIds?: string[] | null;
  affectedModuleKeys?: string[] | null;
  affectedWorkflowKeys?: string[] | null;
  recoveryActionsJson?: unknown;
  automationInvolved?: boolean;
  verificationSummary?: string | null;
  resolutionTimeMs?: number | null;
}): Promise<void> => {
  const signatureText = buildIncidentSignatureText(input);
  const embedding = await embedText(signatureText);
  const now = new Date();
  const timelineJson = input.timeline?.slice(0, 50) ?? undefined;

  await prisma.incidentMemoryEntry.upsert({
    where: { incidentId: input.incidentId },
    update: {
      projectId: input.projectId ?? null,
      title: input.title,
      category: input.category ?? null,
      diagnosisSummary: input.diagnosisSummary,
      rootCause: input.rootCause ?? null,
      resolutionSummary: input.resolutionSummary ?? null,
      signatureText,
      embeddingJson: embedding ?? undefined,
      timelineJson: timelineJson ?? undefined,
      affectedServiceIds: input.affectedServiceIds ?? undefined,
      affectedModuleKeys: input.affectedModuleKeys ?? undefined,
      affectedWorkflowKeys: input.affectedWorkflowKeys ?? undefined,
      recoveryActionsJson: (input.recoveryActionsJson ?? undefined) as Prisma.InputJsonValue | undefined,
      automationInvolved: input.automationInvolved ?? false,
      verificationSummary: input.verificationSummary ?? null,
      resolutionTimeMs: input.resolutionTimeMs ?? null,
      resolvedAt: input.resolvedAt ?? null,
      updatedAt: now
    },
    create: {
      id: randomUUID(),
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      projectId: input.projectId ?? null,
      title: input.title,
      category: input.category ?? null,
      diagnosisSummary: input.diagnosisSummary,
      rootCause: input.rootCause ?? null,
      resolutionSummary: input.resolutionSummary ?? null,
      signatureText,
      embeddingJson: embedding ?? undefined,
      timelineJson: timelineJson ?? undefined,
      affectedServiceIds: input.affectedServiceIds ?? undefined,
      affectedModuleKeys: input.affectedModuleKeys ?? undefined,
      affectedWorkflowKeys: input.affectedWorkflowKeys ?? undefined,
      recoveryActionsJson: (input.recoveryActionsJson ?? undefined) as Prisma.InputJsonValue | undefined,
      automationInvolved: input.automationInvolved ?? false,
      verificationSummary: input.verificationSummary ?? null,
      resolutionTimeMs: input.resolutionTimeMs ?? null,
      resolvedAt: input.resolvedAt ?? null,
      updatedAt: now
    }
  });
};

export const findSimilarIncidents = async (input: {
  organizationId: string;
  context: IncidentAnalysisContext;
  diagnosisSummary: string;
  category?: string | null;
  excludeIncidentId?: string;
  limit?: number;
}): Promise<SimilarIncidentMatch[]> => {
  const limit = input.limit ?? 3;
  const querySignature = buildIncidentSignatureText({
    title: input.context.title,
    category: input.category,
    diagnosisSummary: input.diagnosisSummary,
    alerts: input.context.alerts.map((row) => ({
      title: row.title,
      message: row.message,
      sourceType: row.sourceType
    })),
    timeline: input.context.timeline.map((row) => ({
      eventType: row.eventType,
      summary: row.summary
    }))
  });

  const queryTokens = tokenize(querySignature);
  const queryEmbedding = await embedText(querySignature);

  const rows = await prisma.incidentMemoryEntry.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.excludeIncidentId ? { incidentId: { not: input.excludeIncidentId } } : {})
    },
    orderBy: [{ resolvedAt: "desc" }, { updatedAt: "desc" }],
    take: 100
  });

  const scored = rows
    .map((row) => {
      const storedEmbedding = Array.isArray(row.embeddingJson)
        ? (row.embeddingJson as number[])
        : null;
      const lexical = jaccardSimilarity(queryTokens, tokenize(row.signatureText));
      const semantic =
        queryEmbedding && storedEmbedding
          ? cosineSimilarity(queryEmbedding, storedEmbedding)
          : lexical;
      const categoryBoost =
        input.category && row.category && input.category === row.category ? 0.08 : 0;
      const similarity = Math.min(1, semantic * 0.85 + lexical * 0.15 + categoryBoost);
      return {
        incidentId: row.incidentId,
        title: row.title,
        category: row.category,
        diagnosisSummary: row.diagnosisSummary,
        rootCause: row.rootCause,
        resolutionSummary: row.resolutionSummary,
        similarity,
        resolvedAt: row.resolvedAt?.toISOString() ?? null
      };
    })
    .filter((row) => row.similarity >= 0.2)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);

  return scored;
};
