import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";

export type ProviderCallState = "SUCCEEDED" | "HTTP_ERROR" | "INVALID_RESPONSE" | "UNAVAILABLE";
export async function recordProviderCall(input: {
  organizationId?: string; projectId: string; model: string;
  state: ProviderCallState; httpStatus: number | null;
}) {
  if (!input.organizationId) return;
  try {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true } });
    if (!project) return;
    await prisma.auditLog.create({ data: { id: randomUUID(), organizationId: input.organizationId,
      action: "AI_PROVIDER_CALL", entityType: "PROJECT", entityId: input.projectId,
      metadataJson: { purpose: "INCIDENT_DIAGNOSIS", model: input.model, state: input.state, httpStatus: input.httpStatus } } });
  } catch {
    // Audit storage must not prevent the rules-based diagnosis fallback.
    console.warn("[ai-provider] Runtime evidence could not be recorded.");
  }
}

export function providerRuntimeEvidence(call: { createdAt: Date; metadataJson: unknown } | null, now: Date) {
  const state = (call?.metadataJson as { state?: string } | null)?.state;
  const age = call ? now.getTime() - call.createdAt.getTime() : null;
  const fresh = age !== null && age >= 0 && age < 60 * 60_000;
  return { state: fresh ? state ?? "UNKNOWN" : "UNKNOWN", at: call?.createdAt.toISOString() ?? null,
    reachable: fresh && state === "SUCCEEDED" };
}
