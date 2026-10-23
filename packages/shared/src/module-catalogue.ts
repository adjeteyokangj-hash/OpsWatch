import { z } from "zod";

export const moduleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
export const customModuleSchema = z.object({
  key: moduleKeySchema,
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(1000),
  category: z.string().trim().min(2).max(50),
  terms: z.array(z.string().trim().min(2).max(80)).min(1).max(20),
  capabilities: z.array(z.string().trim().min(2).max(100)).max(20).default([])
}).strict();
export const moduleDecisionSchema = z.object({
  state: z.enum(["APPROVED", "REJECTED", "REMOVED"]),
  note: z.string().trim().max(500).optional(),
  expectedUpdatedAt: z.string().datetime().optional()
}).strict();
export const customModuleUpdateSchema = customModuleSchema.extend({ expectedVersion: z.number().int().positive(), status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE") }).strict();
export const moduleDiscoverySchema = z.object({ inspectWebsite: z.boolean().default(false), useAi: z.boolean().default(false) }).strict();
export const moduleBindingSchema = z.object({ entityId: z.string().min(1).max(200).nullable(), expectedUpdatedAt: z.string().datetime() }).strict();
export type CatalogueDefinition = {
  key: string; label: string; description: string; category: string;
  capabilities: string[]; source: "PLATFORM" | "CUSTOM"; version: number; status: string;
  terms?: string[];
};
export type CatalogueAssignment = {
  moduleKey: string; state: string; confidence: number; source: string;
  evidenceJson: Array<{ source: string; reason: string; reference?: string }>;
  updatedAt: string; decidedAt: string | null; note: string | null;
  verifiedEntityId?: string | null;
};
export type ProjectCatalogue = {
  projectId: string; canManage: boolean; catalogue: CatalogueDefinition[];
  assignments: CatalogueAssignment[];
  verifiedComponents?: Array<{ id: string; name: string; health: string; lastSeenAt: string | null }>;
  discovery: { state: string; method?: string; aiState?: string; missingSources?: string[]; sourcesJson?: unknown; completedAt?: string | null } | null;
};
