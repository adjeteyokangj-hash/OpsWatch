"use client";

/**
 * Local-only preview for the property-aware topology presentation.
 * Not linked from product navigation. Returns a stub in production builds.
 */
import { useMemo, useState } from "react";
import { TopologyCanvas } from "../../../components/topology/topology-canvas";
import type {
  ProjectTopologyResponse,
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

function buildPreviewTopology(): ProjectTopologyResponse {
  const app = node("app:niinai", "NiiNai", "APP", null, "HEALTHY");
  const kanewu = node("module:kanewu", "Kanewu", "MODULE", app.id);
  const community = node("module:c25", "Community 25", "MODULE", app.id);
  const bookings = node("module:bookings", "Bookings", "MODULE", app.id);
  const rooms = node("module:rooms", "Rooms", "MODULE", app.id);
  const frontDesk = node("module:front-desk", "Front desk", "MODULE", app.id);
  const payments = node("module:payments", "Payments", "MODULE", app.id);
  const eod = node("module:eod", "End of day", "MODULE", app.id);
  const reports = node("module:reports", "Reports", "MODULE", app.id);
  const checkIn = node("workflow:checkin", "Check-in", "WORKFLOW", bookings.id);
  const checkOut = node("workflow:checkout", "Check-out", "WORKFLOW", bookings.id);
  const installA = node("installation:a", "Kanewu desktop", "COMPONENT", kanewu.id);
  const installB = node("installation:b", "Community 25 desktop", "COMPONENT", community.id);
  const owner = node("component:owner", "Owner", "COMPONENT", app.id);
  const admin = node("component:admin", "Admin", "COMPONENT", app.id);
  const supabase = node("component:supabase", "Supabase Auth", "COMPONENT", app.id);
  const data = node("component:data", "Supabase Data", "COMPONENT", app.id);

  const nodes = [
    app,
    kanewu,
    community,
    bookings,
    rooms,
    frontDesk,
    payments,
    eod,
    reports,
    checkIn,
    checkOut,
    installA,
    installB,
    owner,
    admin,
    supabase,
    data
  ];

  return {
    project: { id: "preview-niinai", name: "NiiNai (local preview)", status: "UNKNOWN" },
    generatedAt: new Date().toISOString(),
    summary: {
      total: nodes.length,
      healthy: 1,
      degraded: 0,
      critical: 0,
      unknown: nodes.length - 1,
      openAlerts: 0,
      openIncidents: 0
    },
    nodes,
    edges: [
      {
        id: "h1",
        sourceId: kanewu.id,
        targetId: app.id,
        type: "HIERARCHY",
        critical: false,
        status: "UNKNOWN"
      },
      {
        id: "h2",
        sourceId: community.id,
        targetId: app.id,
        type: "HIERARCHY",
        critical: false,
        status: "UNKNOWN"
      },
      {
        id: "d1",
        sourceId: bookings.id,
        targetId: rooms.id,
        type: "DEPENDENCY",
        critical: true,
        status: "UNKNOWN"
      },
      {
        id: "d2",
        sourceId: checkIn.id,
        targetId: bookings.id,
        type: "DEPENDENCY",
        critical: true,
        status: "UNKNOWN"
      },
      {
        id: "d3",
        sourceId: payments.id,
        targetId: bookings.id,
        type: "DEPENDENCY",
        critical: true,
        status: "UNKNOWN"
      }
    ],
    nodeContext: {
      [app.id]: context("application", "application"),
      [kanewu.id]: context("property", "property", "kanewu"),
      [community.id]: context("property", "property", "community-25"),
      [bookings.id]: context("module", "operations"),
      [rooms.id]: context("module", "operations"),
      [frontDesk.id]: context("module", "operations"),
      [payments.id]: context("module", "finance"),
      [eod.id]: context("module", "finance"),
      [reports.id]: context("module", "reporting"),
      [checkIn.id]: context("workflow", "operations"),
      [checkOut.id]: context("workflow", "operations"),
      [installA.id]: context("installation", "installation"),
      [installB.id]: context("installation", "installation"),
      [owner.id]: context("role", "access"),
      [admin.id]: context("role", "access"),
      [supabase.id]: context("service", "cloud"),
      [data.id]: context("service", "cloud")
    }
  };
}

export default function TopologyPreviewPage() {
  const isProduction = process.env.NODE_ENV === "production";
  const topology = useMemo(() => (isProduction ? null : buildPreviewTopology()), [isProduction]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [propertyFocusId, setPropertyFocusId] = useState<string | null>(null);

  if (isProduction || !topology) {
    return (
      <main style={{ padding: 24 }}>
        <p>Topology preview is available in local development only.</p>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 16,
        background: "#f1f5f9",
        display: "grid",
        gap: 12
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Topology presentation preview</h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: "0.9rem" }}>
          Local fixture only — statuses reflect OpsWatch monitoring evidence (unknown until checks run).
          Shared modules appear once; use Property focus to highlight a guest house.
        </p>
      </header>
      <div style={{ height: "calc(100vh - 120px)", minHeight: 640 }}>
        <TopologyCanvas
          topology={topology}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          typeFilter="ALL"
          healthFilter="ALL"
          propertyFocusId={propertyFocusId}
          onPropertyFocusChange={setPropertyFocusId}
          cardsExpanded="selected"
          traceFocus
        />
      </div>
    </main>
  );
}
