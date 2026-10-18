import type { ProjectTopologyResponse, TopologySummary } from "../types/dto";

const summaryFor = (
  nodes: ProjectTopologyResponse["nodes"],
  openAlerts: number,
  openIncidents: number
): TopologySummary => ({
  total: nodes.length,
  healthy: nodes.filter((node) => node.status === "HEALTHY").length,
  degraded: nodes.filter((node) => node.status === "DEGRADED").length,
  critical: nodes.filter((node) => node.status === "CRITICAL").length,
  unknown: nodes.filter((node) => node.status === "UNKNOWN").length,
  openAlerts,
  openIncidents
});

/**
 * Canonical read must not hide services that were never copied into the
 * canonical graph. This only adds missing nodes. It does not delete or
 * overwrite stored topology records.
 */
export const preserveUnmappedLegacyServices = (
  canonical: ProjectTopologyResponse,
  legacy: ProjectTopologyResponse
): ProjectTopologyResponse => {
  const mappedLegacyIds = new Set<string>();
  for (const context of Object.values(canonical.nodeContext)) {
    const legacyServiceId = context.canonical?.legacyServiceId;
    if (legacyServiceId) mappedLegacyIds.add(legacyServiceId);
  }
  const canonicalIds = new Set(canonical.nodes.map((node) => node.id));
  const preserved = legacy.nodes.filter(
    (node) => !mappedLegacyIds.has(node.id) && !canonicalIds.has(node.id)
  );
  if (preserved.length === 0) return canonical;

  const preservedIds = new Set(preserved.map((node) => node.id));
  const visibleIds = new Set<string>([...canonicalIds, ...preservedIds]);
  const edges = [...canonical.edges];
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const edge of legacy.edges) {
    if (!visibleIds.has(edge.sourceId) || !visibleIds.has(edge.targetId)) continue;
    if (edgeIds.has(edge.id)) continue;
    edges.push(edge);
    edgeIds.add(edge.id);
  }

  const nodeContext = { ...canonical.nodeContext };
  for (const node of preserved) {
    const context = legacy.nodeContext[node.id];
    if (context) nodeContext[node.id] = context;
  }
  const nodes = [...canonical.nodes, ...preserved];
  const previous = canonical.readerDiagnostic;

  return {
    ...canonical,
    nodes,
    edges,
    nodeContext,
    summary: summaryFor(nodes, canonical.summary.openAlerts, canonical.summary.openIncidents),
    readerDiagnostic: {
      reader: "CANONICAL",
      fallbackUsed: true,
      canonicalEntityCount: previous?.canonicalEntityCount ?? canonical.nodes.length,
      canonicalRelationshipCount: previous?.canonicalRelationshipCount ?? canonical.edges.length,
      legacyFallbackCount: preserved.length,
      unresolvedCanonicalReferences: previous?.unresolvedCanonicalReferences ?? 0,
      details: [
        ...(previous?.details ?? []),
        `preserved ${preserved.length} legacy service(s) absent from the canonical graph`
      ]
    }
  };
};
