import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { CORE_MODULE_CATALOGUE } from "./module-catalogue.service";
import type { CatalogueDefinition } from "@opswatch/shared";

export const listModuleDefinitions = async (organizationId: string): Promise<CatalogueDefinition[]> => {
  const custom = await prisma.moduleCatalogueDefinition.findMany({ where: { organizationId }, orderBy: { label: "asc" } });
  return [
    ...CORE_MODULE_CATALOGUE.map(row => ({ key: row.key, label: row.label,
      description: `Application capabilities for ${row.label.toLowerCase()}.`, category: row.key === "monitoring" ? "PLATFORM_CORE" : "OPTIONAL",
      capabilities: [...row.terms], source: "PLATFORM" as const, version: 1, status: "ACTIVE" })),
    ...custom.map(row => ({ key: row.key, label: row.label, description: row.description, category: row.category,
      capabilities: row.capabilities, terms: row.terms, source: "CUSTOM" as const, version: row.version, status: row.status }))
  ];
};

export async function recordModuleAudit(tx: Prisma.TransactionClient, input: {
  organizationId: string; userId?: string; projectId?: string; moduleKey: string; action: string; metadata?: Prisma.InputJsonObject;
}) {
  await tx.auditLog.create({ data: {
    id: randomUUID(), organizationId: input.organizationId, userId: input.userId,
    action: input.action, entityType: "MODULE_ASSIGNMENT", entityId: input.projectId ?? input.moduleKey,
    metadataJson: { moduleKey: input.moduleKey, projectId: input.projectId ?? null, ...input.metadata }
  } });
}

export async function decideModule(input: {
  organizationId: string; projectId: string; moduleKey: string; userId?: string;
  state: "APPROVED" | "REJECTED" | "REMOVED"; note?: string; expectedUpdatedAt?: string;
}) {
  return prisma.$transaction(async tx => {
    const existing = await tx.projectModuleAssignment.findUnique({ where: { organizationId_projectId_moduleKey: {
      organizationId: input.organizationId, projectId: input.projectId, moduleKey: input.moduleKey
    } } });
    if (input.expectedUpdatedAt && existing?.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new Error("ASSIGNMENT_CONFLICT");
    }
    const data = { state: input.state, decidedBy: input.userId ?? null, decidedAt: new Date(), note: input.note ?? null,
      ...(input.state !== "APPROVED" ? { verifiedEntityId: null } : {}) };
    const row = await tx.projectModuleAssignment.upsert({
      where: { organizationId_projectId_moduleKey: { organizationId: input.organizationId, projectId: input.projectId, moduleKey: input.moduleKey } },
      create: { ...data, organizationId: input.organizationId, projectId: input.projectId, moduleKey: input.moduleKey,
        source: "OWNER", confidence: 1, evidenceJson: [{ source: "owner_confirmation", reason: "Manual owner decision" }] },
      update: data
    });
    await recordModuleAudit(tx, { ...input, action: `MODULE_${input.state}`, metadata: {
      previousState: existing?.state ?? null, state: input.state, previousNote: existing?.note ?? null, note: input.note ?? null
    } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
