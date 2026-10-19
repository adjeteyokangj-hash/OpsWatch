"use client";

/**
 * Local-only preview for the property-aware topology presentation.
 * Not linked from product navigation. Stubbed in production builds.
 * Middleware also removes public /dev/* access in production.
 */
import { useMemo, useState } from "react";
import type { SelectedTopologyEdge } from "../../../components/topology/topology-edge-style";
import { TopologyCanvas } from "../../../components/topology/topology-canvas";
import { TopologyApplicationPanel } from "../../../components/topology/topology-application-panel";
import { TopologyLiveOpsFeed } from "../../../components/topology/topology-live-ops-feed";
import type {
  ProjectTopologyResponse,
  TopologyEdge,
  TopologyNode,
  TopologyNodeContext
} from "../../../components/topology/topology-types";

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
  parentId: string | null = null,
  status: TopologyNode["status"] = "UNKNOWN"
): TopologyNode => ({
  id,
  name,
  type,
  status,
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

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  type: TopologyEdge["type"] = "DEPENDENCY",
  critical = true
): TopologyEdge => ({
  id,
  sourceId,
  targetId,
  type,
  critical,
  status: "UNKNOWN"
});

/** Fixture mirrors the NiiNai v1.1 topology shape — statuses stay Unknown (honest). */
function buildPreviewTopology(): ProjectTopologyResponse {
  const app = node("app:niinai", "NiiNai Property Management System", "APP", null, "UNKNOWN");
  const kanewu = node("module:kanewu", "Kanewu", "MODULE", app.id);
  const community = node("module:c25", "Community 25", "MODULE", app.id);
  const installA = node("installation:a", "Kanewu desktop", "COMPONENT", kanewu.id);
  const installB = node("installation:b", "Community 25 desktop", "COMPONENT", community.id);

  const bookings = node("module:bookings", "Bookings", "MODULE", app.id);
  const rooms = node("module:rooms", "Rooms", "MODULE", app.id);
  const frontDesk = node("module:front-desk", "Front desk", "MODULE", app.id);
  const payments = node("module:payments", "Payments", "MODULE", app.id);
  const eod = node("module:eod", "End of day", "MODULE", app.id);
  const reports = node("module:reports", "Reports", "MODULE", app.id);
  const phone = node("module:phone", "Phone transactions", "MODULE", app.id);
  const pricing = node("module:pricing", "Pricing", "MODULE", app.id);
  const properties = node("module:properties", "Properties", "MODULE", app.id);
  const access = node("module:access", "Access control", "MODULE", app.id);
  const audit = node("module:audit", "Audit", "MODULE", app.id);
  const sync = node("module:sync", "Synchronisation", "MODULE", app.id);

  const checkIn = node("workflow:checkin", "Check-in", "WORKFLOW", frontDesk.id);
  const checkOut = node("workflow:checkout", "Check-out", "WORKFLOW", frontDesk.id);
  const reservation = node("workflow:reservation", "Reservation", "WORKFLOW", bookings.id);
  const stay = node("workflow:stay", "Stay booking", "WORKFLOW", bookings.id);
  const refund = node("workflow:refund", "Refund processing", "WORKFLOW", payments.id);
  const cash = node("workflow:cash", "Cash reconciliation", "WORKFLOW", eod.id);
  const lifeSync = node("workflow:lifecycle-sync", "Lifecycle synchronisation", "WORKFLOW", sync.id);
  const finSync = node("workflow:financial-sync", "Financial synchronisation", "WORKFLOW", sync.id);
  const roomSync = node("workflow:room-sync", "Room synchronisation", "WORKFLOW", sync.id);

  const owner = node("component:owner", "Owner", "COMPONENT", access.id);
  const admin = node("component:admin", "Admin", "COMPONENT", access.id);
  const manager = node("component:manager", "Manager", "COMPONENT", access.id);
  const receptionist = node("component:receptionist", "Receptionist", "COMPONENT", access.id);

  const cloud = node("component:cloud", "NiiNai Cloud", "COMPONENT", app.id);
  const supabaseAuth = node("component:supabase-auth", "Supabase authentication", "COMPONENT", cloud.id);
  const supabaseData = node("component:supabase-data", "Supabase data", "COMPONENT", cloud.id);
  const localNet = node("component:local-network", "Local network", "COMPONENT", app.id);
  const supplements = node("component:supplements", "Stay supplements", "COMPONENT", pricing.id);

  const nodes = [
    app,
    kanewu,
    community,
    installA,
    installB,
    bookings,
    rooms,
    frontDesk,
    payments,
    eod,
    reports,
    phone,
    pricing,
    properties,
    access,
    audit,
    sync,
    checkIn,
    checkOut,
    reservation,
    stay,
    refund,
    cash,
    lifeSync,
    finSync,
    roomSync,
    owner,
    admin,
    manager,
    receptionist,
    cloud,
    supabaseAuth,
    supabaseData,
    localNet,
    supplements
  ];

  const nodeContext: ProjectTopologyResponse["nodeContext"] = {
    [app.id]: context("application", "application"),
    [kanewu.id]: context("property", "property", "kanewu"),
    [community.id]: context("property", "property", "community-25"),
    [installA.id]: context("installation", "installation"),
    [installB.id]: context("installation", "installation"),
    [bookings.id]: context("module", "operations"),
    [rooms.id]: context("module", "operations"),
    [frontDesk.id]: context("module", "operations"),
    [payments.id]: context("module", "finance"),
    [eod.id]: context("module", "finance"),
    [reports.id]: context("module", "reporting"),
    [phone.id]: context("module", "finance"),
    [pricing.id]: context("module", "operations"),
    [properties.id]: context("module", "property"),
    [access.id]: context("module", "access"),
    [audit.id]: context("module", "reporting"),
    [sync.id]: context("module", "sync"),
    [checkIn.id]: context("workflow", "operations"),
    [checkOut.id]: context("workflow", "operations"),
    [reservation.id]: context("workflow", "operations"),
    [stay.id]: context("workflow", "operations"),
    [refund.id]: context("workflow", "finance"),
    [cash.id]: context("workflow", "finance"),
    [lifeSync.id]: context("workflow", "sync"),
    [finSync.id]: context("workflow", "sync"),
    [roomSync.id]: context("workflow", "sync"),
    [owner.id]: context("role", "access"),
    [admin.id]: context("role", "access"),
    [manager.id]: context("role", "access"),
    [receptionist.id]: context("role", "access"),
    [cloud.id]: context("service", "cloud"),
    [supabaseAuth.id]: context("service", "cloud"),
    [supabaseData.id]: context("service", "cloud"),
    [localNet.id]: context("service", "installation"),
    [supplements.id]: context("component", "operations")
  };

  const edges: TopologyEdge[] = [
    edge("h-kanewu", kanewu.id, app.id, "HIERARCHY", false),
    edge("h-c25", community.id, app.id, "HIERARCHY", false),
    edge("d-bookings-rooms", bookings.id, rooms.id),
    edge("d-bookings-pricing", bookings.id, pricing.id),
    edge("d-bookings-properties", bookings.id, properties.id),
    edge("d-checkin-bookings", checkIn.id, bookings.id),
    edge("d-checkin-rooms", checkIn.id, rooms.id),
    edge("d-checkout-bookings", checkOut.id, bookings.id),
    edge("d-payments-bookings", payments.id, bookings.id),
    edge("d-refund-payments", refund.id, payments.id),
    edge("d-phone-properties", phone.id, properties.id),
    edge("d-eod-payments", eod.id, payments.id),
    edge("d-eod-phone", eod.id, phone.id),
    edge("d-cash-eod", cash.id, eod.id),
    edge("d-reports-bookings", reports.id, bookings.id, "DEPENDENCY", false),
    edge("d-reports-payments", reports.id, payments.id, "DEPENDENCY", false),
    edge("d-access-auth", access.id, supabaseAuth.id),
    edge("d-sync-data", sync.id, supabaseData.id)
  ];

  return {
    project: { id: "preview-niinai", name: "NiiNai (local preview)", status: "UNKNOWN" },
    generatedAt: "2026-10-18T12:00:00.000Z",
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
    edges,
    nodeContext
  };
}

export default function TopologyPreviewPage() {
  const isProduction = process.env.NODE_ENV === "production";
  const topology = useMemo(() => (isProduction ? null : buildPreviewTopology()), [isProduction]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedTopologyEdge | null>(null);
  const [propertyFocusId, setPropertyFocusId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  if (isProduction || !topology) {
    return (
      <main style={{ padding: 24 }}>
        <p>Topology preview is available in local development only.</p>
      </main>
    );
  }

  const selectedNode = topology.nodes.find((row) => row.id === selectedNodeId) ?? null;

  return (
    <main className="topology-preview-shell">
      <header>
        <h1 style={{ margin: 0, fontSize: "1.35rem", color: "#0f172a" }}>
          Topology presentation preview
        </h1>
        <p className="topology-preview-note">
          <strong>Local fixture</strong> shaped like the NiiNai graph. Shared modules appear once
          (not duplicated under each guest house). Statuses stay Unknown until real OpsWatch checks
          exist — this is intentional, not a rendering defect.
        </p>
      </header>
      <div className="topology-workspace">
        <TopologyCanvas
          topology={topology}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          selectedEdgeId={selectedEdge?.id ?? null}
          onSelectEdge={setSelectedEdge}
          typeFilter="ALL"
          healthFilter="ALL"
          propertyFocusId={propertyFocusId}
          onPropertyFocusChange={setPropertyFocusId}
          cardsExpanded="selected"
          traceFocus
          onInteractingChange={setPaused}
        />
        <div className="topology-side-stack">
          <TopologyApplicationPanel
            topology={topology}
            projectId="preview-niinai"
            project={{ environment: "local-preview", publicUrl: null, appVersion: "fixture", incidents: [] }}
          />
          <TopologyLiveOpsFeed
            projectId="preview-niinai"
            topology={topology}
            project={{}}
            selectedNode={selectedNode}
            paused={paused}
            signalsEnabled={false}
          />
        </div>
      </div>
    </main>
  );
}
