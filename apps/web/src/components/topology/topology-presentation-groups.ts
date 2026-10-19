import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";

export type PresentationSectionTone =
  | "property-a"
  | "property-b"
  | "shared"
  | "processes"
  | "access"
  | "infra";

export type PresentationSectionId =
  | "application"
  | `property:${string}`
  | "shared"
  | "processes"
  | "access"
  | "infrastructure";

export type PresentationSection = {
  id: PresentationSectionId;
  title: string;
  tone: PresentationSectionTone;
  nodeIds: string[];
  /** Property focus id when this section is a guest-house container. */
  propertyNodeId?: string;
};

export type TopologyPresentationGroups = {
  sections: PresentationSection[];
  propertyOptions: Array<{ id: string; name: string }>;
  /** Modules conceptually associated with every property (highlighted on focus). */
  propertyAssociatedIds: Set<string>;
};

const SHARED_OPS_NAMES = new Set(
  [
    "bookings",
    "rooms",
    "front desk",
    "payments",
    "end of day",
    "reports",
    "phone transactions",
    "pricing",
    "properties",
    "synchronisation",
    "audit"
  ].map((name) => name.toLowerCase())
);

const PROCESS_HINT =
  /check-?in|check-?out|reservation|stay|refund|synchronisation|sync|cash reconciliation/i;

const INFRA_HINT =
  /cloud|supabase|network|desktop|supplement|auth|data|installation/i;

const ACCESS_HINT = /owner|admin|manager|receptionist|access control/i;

const nodeKind = (node: TopologyNode, topology: ProjectTopologyResponse): string =>
  (node.kind ?? topology.nodeContext[node.id]?.manifest?.kind ?? "").toLowerCase();

const nodeCategory = (node: TopologyNode, topology: ProjectTopologyResponse): string =>
  (topology.nodeContext[node.id]?.manifest?.category ?? "").toLowerCase();

/** Guest-house properties are kind=property — not the Properties catalogue module. */
const isPropertyNode = (node: TopologyNode, topology: ProjectTopologyResponse): boolean =>
  nodeKind(node, topology) === "property";

const isInstallation = (node: TopologyNode, topology: ProjectTopologyResponse): boolean =>
  nodeKind(node, topology) === "installation" ||
  nodeCategory(node, topology) === "installation" ||
  node.id.startsWith("installation:");

const isApp = (node: TopologyNode): boolean => node.type === "APP";

/** Installations whose parent points at this property. */
export const installationsForProperty = (
  property: TopologyNode,
  topology: ProjectTopologyResponse
): TopologyNode[] =>
  topology.nodes.filter(
    (node) => isInstallation(node, topology) && node.parentId === property.id
  );

const classifySharedOrProcess = (
  node: TopologyNode,
  topology: ProjectTopologyResponse
): "shared" | "processes" | "access" | "infrastructure" | null => {
  if (isApp(node) || isPropertyNode(node, topology) || isInstallation(node, topology)) {
    return null;
  }
  const category = nodeCategory(node, topology);
  const kind = nodeKind(node, topology);
  const name = node.name.toLowerCase();

  if (category === "access" || ACCESS_HINT.test(name) || ACCESS_HINT.test(kind)) {
    return "access";
  }
  if (/supplement/i.test(name) || /local network/i.test(name)) return "infrastructure";
  // Shared modules keep their identity even when their category describes a process.
  if (node.type === "MODULE" && SHARED_OPS_NAMES.has(name)) return "shared";
  if (
    kind === "workflow" ||
    category === "sync" ||
    PROCESS_HINT.test(name) ||
    node.type === "WORKFLOW"
  ) {
    return "processes";
  }
  if (
    category === "cloud" ||
    INFRA_HINT.test(name) ||
    INFRA_HINT.test(category) ||
    (node.type === "COMPONENT" && (category === "cloud" || /supabase|network|cloud/i.test(name)))
  ) {
    if (category === "cloud" || /supabase|cloud|network|desktop|installation/i.test(name)) {
      return "infrastructure";
    }
  }
  if (
    SHARED_OPS_NAMES.has(name) ||
    category === "operations" ||
    category === "finance" ||
    category === "reporting" ||
    category === "property" ||
    node.type === "MODULE"
  ) {
    return "shared";
  }
  if (node.type === "COMPONENT") return "infrastructure";
  return "shared";
};

/**
 * Build presentation sections when the graph contains property nodes.
 * Returns null for projects without property metadata so the legacy layout remains.
 */
export const buildTopologyPresentationGroups = (
  topology: ProjectTopologyResponse
): TopologyPresentationGroups | null => {
  const propertyRank = (name: string): number => {
    if (/kanewu/i.test(name)) return 0;
    if (/community\s*25/i.test(name)) return 1;
    return 2;
  };
  const properties = topology.nodes
    .filter((node) => isPropertyNode(node, topology))
    .sort((a, b) => {
      const rankDelta = propertyRank(a.name) - propertyRank(b.name);
      return rankDelta !== 0 ? rankDelta : a.name.localeCompare(b.name);
    });
  if (properties.length === 0) return null;

  const claimed = new Set<string>();
  const sections: PresentationSection[] = [];

  const apps = topology.nodes.filter(isApp).sort((a, b) => a.name.localeCompare(b.name));
  for (const app of apps) claimed.add(app.id);

  properties.forEach((property, index) => {
    const installations = installationsForProperty(property, topology);
    const nodeIds = [property.id, ...installations.map((row) => row.id)];
    for (const id of nodeIds) claimed.add(id);
    const tone: PresentationSectionTone = /kanewu/i.test(property.name)
      ? "property-a"
      : /community/i.test(property.name)
        ? "property-b"
        : index % 2 === 0
          ? "property-a"
          : "property-b";
    sections.push({
      id: `property:${property.id}`,
      title: `${property.name} Guest House`,
      tone,
      nodeIds,
      propertyNodeId: property.id
    });
  });

  const buckets: Record<"shared" | "processes" | "access" | "infrastructure", TopologyNode[]> = {
    shared: [],
    processes: [],
    access: [],
    infrastructure: []
  };

  for (const node of topology.nodes) {
    if (claimed.has(node.id) || isApp(node)) continue;
    const bucket = classifySharedOrProcess(node, topology);
    if (!bucket) continue;
    buckets[bucket].push(node);
    claimed.add(node.id);
  }

  // Any leftover nodes land in infrastructure so nothing disappears.
  for (const node of topology.nodes) {
    if (claimed.has(node.id) || isApp(node)) continue;
    buckets.infrastructure.push(node);
    claimed.add(node.id);
  }

  const pushBucket = (
    id: PresentationSectionId,
    title: string,
    tone: PresentationSectionTone,
    nodes: TopologyNode[]
  ) => {
    if (nodes.length === 0) return;
    sections.push({
      id,
      title,
      tone,
      nodeIds: nodes.sort((a, b) => a.name.localeCompare(b.name)).map((row) => row.id)
    });
  };

  pushBucket("shared", "Shared Services", "shared", buckets.shared);
  pushBucket("processes", "Business Processes", "processes", buckets.processes);
  pushBucket("access", "Access Control", "access", buckets.access);
  pushBucket("infrastructure", "Infrastructure & Data", "infra", buckets.infrastructure);

  const propertyAssociatedIds = new Set<string>();
  for (const node of buckets.shared) {
    if (SHARED_OPS_NAMES.has(node.name.toLowerCase()) || nodeCategory(node, topology) === "operations") {
      propertyAssociatedIds.add(node.id);
    }
  }
  for (const node of buckets.processes) {
    if (/check-?in|check-?out|reservation|stay|refund|room sync|lifecycle|financial/i.test(node.name)) {
      propertyAssociatedIds.add(node.id);
    }
  }

  return {
    sections,
    propertyOptions: properties.map((row) => ({ id: row.id, name: row.name })),
    propertyAssociatedIds
  };
};

/** Node ids to emphasize for a property focus selection. */
export const focusIdsForProperty = (
  propertyId: string,
  groups: TopologyPresentationGroups,
  appNodeIds: string[] = []
): Set<string> => {
  const ids = new Set<string>();
  for (const id of appNodeIds) ids.add(id);
  const propertySection = groups.sections.find((section) => section.propertyNodeId === propertyId);
  for (const id of propertySection?.nodeIds ?? []) ids.add(id);
  for (const id of groups.propertyAssociatedIds) ids.add(id);
  return ids;
};
