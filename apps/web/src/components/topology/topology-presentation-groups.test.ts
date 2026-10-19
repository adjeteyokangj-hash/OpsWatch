import { describe, expect, it } from "vitest";
import {
  buildTopologyPresentationGroups,
  focusIdsForProperty
} from "./topology-presentation-groups";
import { computePresentationLayout, PRESENTATION_LAYOUT } from "./topology-layout";
import type { ProjectTopologyResponse, TopologyNode, TopologyNodeContext } from "./topology-types";

const baseMetrics = {
  availabilityPercent: null as number | null,
  latencyMs: null as number | null,
  errorRatePercent: null as number | null,
  sloBurnRate: null as number | null,
  availabilityTrend: [] as number[]
};

const node = (
  id: string,
  name: string,
  type: TopologyNode["type"],
  parentId: string | null = null
): TopologyNode => ({
  id,
  name,
  type,
  status: "UNKNOWN",
  parentId,
  metrics: { ...baseMetrics },
  risk: { openAlerts: 0, unresolvedIncidents: 0 }
});

const context = (
  kind: string,
  category: string,
  externalId: string | null = null
): TopologyNodeContext => ({
  monitoringState: "AWAITING_FIRST_CHECK",
  lastCheckAt: null,
  lastCheckStatus: null,
  sloStatus: null,
  openAlerts: [],
  unresolvedIncidents: [],
  upstreamIds: [],
  downstreamIds: [],
  manifest: {
    kind,
    category,
    externalId,
    healthBinding: null,
    evidence: "missing",
    lastSuccessAt: null,
    lastFailureAt: null,
    computers: [],
    potentialImpact: []
  }
});

const niinaTopology = (): ProjectTopologyResponse => {
  const app = node("app:niinai", "NiiNai", "APP");
  const kanewu = node("module:kanewu", "Kanewu", "MODULE", app.id);
  const community = node("module:c25", "Community 25", "MODULE", app.id);
  const bookings = node("module:bookings", "Bookings", "MODULE", app.id);
  const rooms = node("module:rooms", "Rooms", "MODULE", app.id);
  const checkIn = node("workflow:checkin", "Check-in", "WORKFLOW", bookings.id);
  const installA = node("installation:a", "Front desk PC", "COMPONENT", kanewu.id);
  const installB = node("installation:b", "Lobby PC", "COMPONENT", community.id);
  const owner = node("component:owner", "Owner", "COMPONENT", app.id);
  const supabase = node("component:supabase", "Supabase Auth", "COMPONENT", app.id);

  const nodes = [
    app,
    kanewu,
    community,
    bookings,
    rooms,
    checkIn,
    installA,
    installB,
    owner,
    supabase
  ];

  return {
    project: { id: "p1", name: "NiiNai", status: "UNKNOWN" },
    generatedAt: new Date().toISOString(),
    summary: {
      total: nodes.length,
      healthy: 0,
      degraded: 0,
      critical: 0,
      unknown: nodes.length,
      openAlerts: 0,
      openIncidents: 0
    },
    nodes,
    edges: [],
    nodeContext: {
      [app.id]: context("application", "application"),
      [kanewu.id]: context("property", "property", "kanewu"),
      [community.id]: context("property", "property", "community-25"),
      [bookings.id]: context("module", "operations"),
      [rooms.id]: context("module", "operations"),
      [checkIn.id]: context("workflow", "operations"),
      [installA.id]: context("installation", "installation"),
      [installB.id]: context("installation", "installation"),
      [owner.id]: context("role", "access"),
      [supabase.id]: context("service", "cloud")
    }
  };
};

describe("buildTopologyPresentationGroups", () => {
  it("returns null when the graph has no property nodes", () => {
    const topology = niinaTopology();
    topology.nodes = topology.nodes.filter((row) => row.type === "APP" || row.name === "Bookings");
    topology.nodeContext = {
      [topology.nodes[0]!.id]: topology.nodeContext[topology.nodes[0]!.id]!,
      [topology.nodes[1]!.id]: topology.nodeContext[topology.nodes[1]!.id]!
    };
    expect(buildTopologyPresentationGroups(topology)).toBeNull();
  });

  it("places guest houses separately and keeps shared modules once", () => {
    const topology = niinaTopology();
    const groups = buildTopologyPresentationGroups(topology);
    expect(groups).not.toBeNull();
    expect(groups!.propertyOptions.map((row) => row.name)).toEqual([
      "Kanewu",
      "Community 25"
    ]);

    const propertySections = groups!.sections.filter((section) => section.propertyNodeId);
    expect(propertySections).toHaveLength(2);
    const kanewuSection = propertySections.find((section) => section.propertyNodeId === "module:kanewu");
    expect(kanewuSection?.nodeIds).toContain("module:kanewu");
    expect(kanewuSection?.nodeIds).toContain("installation:a");
    expect(kanewuSection?.nodeIds).not.toContain("module:bookings");

    const shared = groups!.sections.find((section) => section.id === "shared");
    expect(shared?.nodeIds).toContain("module:bookings");
    expect(shared?.nodeIds).toContain("module:rooms");
    expect(shared?.nodeIds.filter((id) => id === "module:bookings")).toHaveLength(1);
  });

  it("highlights associated shared modules for a property focus", () => {
    const topology = niinaTopology();
    const groups = buildTopologyPresentationGroups(topology)!;
    const focus = focusIdsForProperty("module:kanewu", groups, ["app:niinai"]);
    expect(focus.has("app:niinai")).toBe(true);
    expect(focus.has("module:kanewu")).toBe(true);
    expect(focus.has("installation:a")).toBe(true);
    expect(focus.has("module:bookings")).toBe(true);
    expect(focus.has("module:c25")).toBe(false);
    expect(focus.has("installation:b")).toBe(false);
  });
});

describe("presentation regressions", () => {
  it.each(["TrueNumeris", "OkangGroup", "Other application"])("preserves the legacy layout for %s without property metadata", name => {
    const topology = niinaTopology();
    topology.project.name = name;
    topology.nodes = topology.nodes.filter(row => !["module:kanewu", "module:c25"].includes(row.id));
    expect(buildTopologyPresentationGroups(topology)).toBeNull();
  });

  it("keeps the Synchronisation module shared and its workflows in Business Processes", () => {
    const topology = niinaTopology();
    topology.nodes.push(node("sync", "Synchronisation", "MODULE"), node("sync-flow", "Room synchronisation", "WORKFLOW"));
    topology.nodeContext.sync = context("module", "sync");
    topology.nodeContext["sync-flow"] = context("workflow", "sync");
    const groups = buildTopologyPresentationGroups(topology)!;
    expect(groups.sections.find(section => section.id === "shared")?.nodeIds).toContain("sync");
    expect(groups.sections.find(section => section.id === "processes")?.nodeIds).toContain("sync-flow");
    const ids = groups.sections.flatMap(section => section.nodeIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps dense property cards inside their containers and apart", () => {
    const topology = niinaTopology();
    for (let i = 0; i < 8; i++) {
      topology.nodes.push(node('installation:extra-' + i, 'Desktop ' + i, 'COMPONENT', 'module:kanewu'));
    }
    const groups = buildTopologyPresentationGroups(topology)!;
    const layout = computePresentationLayout(topology.nodes, groups);
    for (const section of groups.sections.filter(section => section.propertyNodeId)) {
      const band = layout.layerBands.find(band => band.bandKey === section.id)!;
      const positions = section.nodeIds.map(id => layout.positions.get(id)!);
      for (const position of positions) {
        expect(position.x - PRESENTATION_LAYOUT.nodeWidth / 2).toBeGreaterThanOrEqual(band.bandX!);
        expect(position.x + PRESENTATION_LAYOUT.nodeWidth / 2).toBeLessThanOrEqual(band.bandX! + band.bandWidth!);
        expect(position.y + PRESENTATION_LAYOUT.nodeHeight / 2).toBeLessThanOrEqual(band.y + band.height);
      }
      positions.forEach((a, i) => positions.slice(i + 1).forEach(b => {
        expect(Math.abs(a.x - b.x) >= PRESENTATION_LAYOUT.nodeWidth || Math.abs(a.y - b.y) >= PRESENTATION_LAYOUT.nodeHeight).toBe(true);
      }));
    }
  });
});

describe("computePresentationLayout", () => {
  it("lays out property containers side by side without cloning shared modules", () => {
    const topology = niinaTopology();
    const groups = buildTopologyPresentationGroups(topology)!;
    const layout = computePresentationLayout(topology.nodes, groups, 1400);

    const kanewuBand = layout.layerBands.find((band) => band.bandKey.includes("module:kanewu"));
    const communityBand = layout.layerBands.find((band) => band.bandKey.includes("module:c25"));
    expect(kanewuBand).toBeTruthy();
    expect(communityBand).toBeTruthy();
    expect(kanewuBand!.bandX).toBeDefined();
    expect(communityBand!.bandX).toBeDefined();
    expect(kanewuBand!.bandX).not.toEqual(communityBand!.bandX);
    expect(Math.abs(kanewuBand!.y - communityBand!.y)).toBeLessThan(1);

    expect(layout.positions.has("module:bookings")).toBe(true);
    expect(layout.visibleNodeIds.has("module:bookings")).toBe(true);
    expect(layout.moreNodes).toHaveLength(0);
  });
});
