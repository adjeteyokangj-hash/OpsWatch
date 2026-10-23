import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { readPublicWebsiteHtml } from "./public-website-metadata";
import { proposeProjectModules } from "./module-catalogue.service";
import { recordModuleAudit } from "./module-assignment.service";
import { recommendModulesWithAi } from "./module-ai-discovery.service";

export type DiscoveryEvidence = { source: string; reason: string; reference?: string };
export const extractWebsiteMetadata = (html: string): string => {
  // Only passive metadata is admitted. Scripts, body instructions and links are
  // never interpreted as commands or followed by discovery.
  const title = html.match(/<title\b[^>]*>([^<]{0,200})<\/title\s*>/i)?.[1] ?? "";
  const descriptions = [...html.matchAll(/<meta\b[^>]{0,1500}>/gi)].flatMap(([tag]) => {
    if (!/\b(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag)) return [];
    return [tag.match(/\bcontent\s*=\s*["']([^"']{0,500})["']/i)?.[1] ?? ""];
  });
  return [title, ...descriptions.slice(0, 2)].join(" ").replace(/<[^>]*>/g, "").slice(0, 1200);
};

async function readWebsiteMetadata(raw: string): Promise<string> {
  return extractWebsiteMetadata(await readPublicWebsiteHtml(raw));
}

export async function discoverProjectModules(input: {
  organizationId: string; projectId: string; userId?: string; inspectWebsite: boolean; useAi: boolean; capabilityFingerprint?: string;
}) {
  const project = await prisma.project.findFirstOrThrow({ where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, name: true, description: true, frontendUrl: true } });
  // Database uniqueness bounds analysis across instances, not just one server.
  const run = await prisma.moduleDiscoveryRun.create({ data: {
    organizationId: input.organizationId, projectId: project.id, slot: Math.floor(Date.now() / 60_000), sourcesJson: []
  } });
  try {
    const evidence: DiscoveryEvidence[] = [{ source: "description", reason: project.description?.slice(0, 4000) || project.name }];
    const missing: string[] = [];
    if (input.inspectWebsite && project.frontendUrl) {
      try {
        const metadata = await readWebsiteMetadata(project.frontendUrl);
        if (metadata) evidence.push({ source: "website_metadata", reason: metadata, reference: new URL(project.frontendUrl).origin });
        else missing.push("website_metadata_empty");
      } catch { missing.push("website_metadata_unavailable"); }
    } else missing.push("website_metadata_not_requested");
    const connections = await prisma.connection.findMany({
      where: { organizationId: input.organizationId, projectId: project.id, mode: "API", isActive: true },
      select: { id: true, capabilitiesJson: true, lastSyncAt: true, lastSyncStatus: true }, take: 30
    });
    for (const connection of connections) {
      if (connection.lastSyncStatus !== "SUCCEEDED" || !connection.lastSyncAt || Date.now() - connection.lastSyncAt.getTime() > 86_400_000) continue;
      // Import audits contain business module keys actually returned by the
      // authorised application, not generic connector permission declarations.
      const imported = await prisma.auditLog.findFirst({ where: { organizationId: input.organizationId,
        action: "CONNECTION_TOPOLOGY_RECONCILED", entityId: connection.id }, orderBy: { createdAt: "desc" }, select: { metadataJson: true } });
      const meta = imported?.metadataJson as { moduleKeys?: unknown } | null;
      const keys = Array.isArray(meta?.moduleKeys) ? meta.moduleKeys.filter((key): key is string => typeof key === "string").slice(0, 100) : [];
      if (keys.length) evidence.push({ source: "connected_api", reason: keys.join(" ").slice(0, 2000), reference: connection.id });
    }
    if (!evidence.some(row => row.source === "connected_api")) missing.push("fresh_authorised_api_capabilities");
    const custom = await prisma.moduleCatalogueDefinition.findMany({ where: { organizationId: input.organizationId, status: "ACTIVE" } });
    const proposals = new Map<string, { confidence: number; evidence: DiscoveryEvidence[] }>();
    for (const item of evidence) {
      const matches = proposeProjectModules({ description: item.reason,
        extensions: custom.map(row => ({ key: row.key, label: row.label, terms: row.terms })) });
      for (const match of matches) {
        const existing = proposals.get(match.key) ?? { confidence: 0, evidence: [] };
        existing.confidence = Math.max(existing.confidence, item.source === "connected_api" ? 0.9 : item.source === "description" ? 0.65 : 0.4);
        existing.evidence.push(item);
        proposals.set(match.key, existing);
      }
    }
    const ai = input.useAi ? await recommendModulesWithAi([
      ...(await import("./module-catalogue.service")).CORE_MODULE_CATALOGUE,
      ...custom
    ], evidence) : { state: "NOT_REQUESTED", recommendations: [] };
    for (const recommendation of ai.recommendations) {
      const source = evidence[recommendation.sourceIndex];
      if (!source) continue;
      const existing = proposals.get(recommendation.moduleKey) ?? { confidence: 0, evidence: [] };
      existing.confidence = Math.max(existing.confidence, Math.min(recommendation.confidence, 0.8));
      existing.evidence.push({ source: "ai_recommendation", reason: recommendation.quote, reference: source.reference ?? source.source });
      proposals.set(recommendation.moduleKey, existing);
    }
    if (input.useAi && ai.state !== "COMPLETED") missing.push(`ai_${ai.state.toLowerCase()}`);
    await prisma.$transaction(async tx => {
      for (const [moduleKey, proposal] of proposals) {
        const data = { confidence: proposal.confidence, source: "DISCOVERY", evidenceJson: proposal.evidence as Prisma.InputJsonValue };
        await tx.projectModuleAssignment.createMany({ data: [{ organizationId: input.organizationId,
          projectId: project.id, moduleKey, state: "PROPOSED", ...data }], skipDuplicates: true });
        // Never overwrite an owner decision or restore a removed assignment.
        await tx.projectModuleAssignment.updateMany({ where: { organizationId: input.organizationId, projectId: project.id,
          moduleKey, state: "PROPOSED", decidedAt: null }, data });
      }
      await tx.moduleDiscoveryRun.update({ where: { id: run.id }, data: {
        status: missing.length ? "PARTIAL" : "COMPLETED", completedAt: new Date(),
        sourcesJson: { sources: evidence.map(({ source, reference }) => ({ source, reference: reference ?? null })), missing,
          method: input.useAi ? "AI_ASSISTED" : "EVIDENCE_RULES", aiState: ai.state, proposals: proposals.size,
          capabilityFingerprint: input.capabilityFingerprint ?? null }
      } });
      await recordModuleAudit(tx, { ...input, moduleKey: "discovery", action: "MODULE_DISCOVERY_COMPLETED", metadata: { runId: run.id, proposals: proposals.size } });
    });
    return { runId: run.id, proposals: proposals.size, missing, method: input.useAi ? "AI_ASSISTED" : "EVIDENCE_RULES", aiState: ai.state };
  } catch (error) {
    await prisma.moduleDiscoveryRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), sourcesJson: { error: "Discovery failed; retry after checking source availability" } } });
    throw error;
  }
}

export async function refreshModuleProposalsAfterImport(organizationId: string, projectId: string, moduleKeys: string[]) {
  const fingerprint = createHash("sha256").update(JSON.stringify([...moduleKeys].sort())).digest("hex");
  const latest = await prisma.moduleDiscoveryRun.findFirst({ where: { organizationId, projectId, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" } });
  const meta = latest?.sourcesJson as { capabilityFingerprint?: string } | null;
  if (meta?.capabilityFingerprint === fingerprint) return;
  await discoverProjectModules({ organizationId, projectId, inspectWebsite: false, useAi: false, capabilityFingerprint: fingerprint });
}
