"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";
import { healthClassName, healthLabel, unknownHealthReason } from "./topology-types";
import { TopologySparkline } from "./topology-sparkline";
import { TopologyApplicationPanel } from "./topology-application-panel";
import { buildNodeRelationshipDiagnostics } from "./topology-relationship";

type Props = {
  topology: ProjectTopologyResponse;
  node: TopologyNode | null;
  projectId: string;
  project?: any;
  onClose: () => void;
};

type DetailTab = "overview" | "health" | "dependencies" | "alerts";

const formatRelativeTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const ageMs = Date.now() - new Date(value).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 2) return "Just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours} h ago`;
  return new Date(value).toLocaleString();
};

export const TopologyNodeDrawer = ({ topology, node, projectId, project, onClose }: Props) => {
  const [tab, setTab] = useState<DetailTab>("overview");

  if (!node) {
    return <TopologyApplicationPanel topology={topology} projectId={projectId} project={project} />;
  }

  const context = topology.nodeContext[node.id];
  const relationship = buildNodeRelationshipDiagnostics(topology).find((row) => row.moduleId === node.id);
  const nodeById = new Map(topology.nodes.map((row) => [row.id, row]));
  const childWorkflows = (context?.downstreamIds ?? []).filter((id) => nodeById.get(id)?.type === "WORKFLOW").length;
  const childComponents = (context?.downstreamIds ?? []).filter((id) => nodeById.get(id)?.type === "COMPONENT").length;
  const availability = node.metrics.availabilityPercent;

  const overviewRows = [
    { label: "Health", value: healthLabel(node.status) },
    { label: "Availability", value: availability == null ? "—" : `${availability.toFixed(1)}%` },
    { label: "Last check", value: formatRelativeTime(context?.lastCheckAt) },
    { label: "Relationships", value: String(relationship?.totalRelationshipCount ?? 0) },
    {
      label: "Connection state",
      value:
        relationship?.connectionState === "discovery_incomplete"
          ? "Discovery pending"
          : relationship?.connectionState === "intentionally_isolated"
            ? "No mapped dependencies"
            : "Connected"
    },
    { label: "Active incidents", value: String(node.risk.unresolvedIncidents) },
    { label: "Child workflows", value: String(childWorkflows) },
    { label: "Child components", value: String(childComponents) },
    { label: "Open alerts", value: String(node.risk.openAlerts) },
    { label: "SLO state", value: context?.sloStatus ?? "—" }
  ];

  const healthRows = [
    { label: "Status", value: healthLabel(node.status) },
    { label: "Availability", value: availability == null ? "—" : `${availability.toFixed(1)}%` },
    { label: "Latency", value: node.metrics.latencyMs == null ? "—" : `${node.metrics.latencyMs} ms` },
    { label: "Error rate", value: node.metrics.errorRatePercent == null ? "—" : `${node.metrics.errorRatePercent}%` },
    { label: "SLO burn", value: node.metrics.sloBurnRate == null ? "—" : String(node.metrics.sloBurnRate) },
    { label: "Monitoring", value: context?.monitoringState?.replaceAll("_", " ").toLowerCase() ?? "—" }
  ];

  const quickActions = [
    { label: "View checks", href: `/checks?projectId=${projectId}&serviceId=${node.id}`, primary: true },
    { label: "Run check", href: `/checks?projectId=${projectId}&serviceId=${node.id}`, primary: false },
    node.type === "WORKFLOW" || node.type === "MODULE"
      ? { label: "View workflows", href: `/projects/${projectId}/workflows`, primary: false }
      : null,
    node.type === "MODULE"
      ? { label: "Edit module", href: `/projects/${projectId}/modules`, primary: false }
      : null,
    { label: "View alerts", href: `/alerts?projectId=${projectId}&serviceId=${node.id}`, primary: false }
  ].filter(Boolean) as Array<{ label: string; href: string; primary: boolean }>;

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "health", label: "Health" },
    { id: "dependencies", label: "Dependencies" },
    { id: "alerts", label: "Alerts" }
  ];

  return (
    <aside className="topology-detail-panel panel" aria-label="Selected node details">
      <div className="topology-detail-head">
        <div>
          <p className="topology-detail-type">{node.type}</p>
          <h2>{node.name}</h2>
        </div>
        <div className="topology-detail-head-actions">
          <span className={`topology-detail-badge ${healthClassName(node.status)}`}>{healthLabel(node.status)}</span>
          <div className="topology-detail-icon-actions" aria-label="Node actions">
            <button type="button" className="topology-icon-button" aria-label="Pin node">
              ☆
            </button>
            <button type="button" className="topology-icon-button" aria-label="Share node">
              ↗
            </button>
            <button type="button" className="topology-icon-button" aria-label="Expand details">
              ⤢
            </button>
          </div>
          <button type="button" className="secondary-button" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </div>

      <div className="topology-detail-tabs" role="tablist" aria-label="Node detail sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "active" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          {node.status === "UNKNOWN" ? (
            <section className="topology-detail-section topology-unknown-reason" role="status">
              <h3>Why health is unknown</h3>
              <p>
                {unknownHealthReason({
                  monitoringState: context?.monitoringState,
                  lastCheckAt: context?.lastCheckAt,
                  openAlerts: node.risk.openAlerts
                })}
              </p>
            </section>
          ) : null}
          {relationship?.isolatedStateReason ? (
            <section className="topology-detail-section topology-isolation-reason" role="status" data-testid="topology-isolation-reason">
              <h3>Relationship status</h3>
              <p>{relationship.isolatedStateReason}</p>
            </section>
          ) : null}
          <section className="topology-detail-section">
            <dl className="topology-detail-grid">
              {overviewRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="topology-detail-section">
            <h3>Success rate</h3>
            <TopologySparkline
              points={node.metrics.availabilityTrend}
              tone={
                node.status === "HEALTHY"
                  ? "healthy"
                  : node.status === "DEGRADED"
                    ? "degraded"
                    : node.status === "CRITICAL"
                      ? "critical"
                      : "neutral"
              }
            />
          </section>
          <section className="topology-detail-section">
            <h3>Quick actions</h3>
            <div className="topology-action-grid">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className={action.primary ? "primary-button topology-action-btn" : "secondary-button topology-action-btn"}
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {tab === "health" ? (
        <section className="topology-detail-section">
          <dl className="topology-detail-grid">
            {healthRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {tab === "dependencies" ? (
        <section className="topology-detail-section">
          <p className="topology-detail-subheading">Upstream</p>
          <ul className="topology-mini-list">
            {(context?.upstreamIds ?? []).length === 0 ? (
              <li className="dashboard-subtle">None</li>
            ) : (
              context!.upstreamIds.map((id) => <li key={id}>{nodeById.get(id)?.name ?? id}</li>)
            )}
          </ul>
          <p className="topology-detail-subheading">Dependants</p>
          <ul className="topology-mini-list">
            {(context?.downstreamIds ?? []).length === 0 ? (
              <li className="dashboard-subtle">None</li>
            ) : (
              context!.downstreamIds.map((id) => <li key={id}>{nodeById.get(id)?.name ?? id}</li>)
            )}
          </ul>
        </section>
      ) : null}

      {tab === "alerts" ? (
        <section className="topology-detail-section">
          {context && context.openAlerts.length > 0 ? (
            <ul className="topology-alert-list">
              {context.openAlerts.slice(0, 6).map((alert) => (
                <li key={alert.id}>
                  <Link href={`/alerts/${alert.id}`}>{alert.title}</Link>
                  <span className="dashboard-subtle">{alert.severity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dashboard-subtle">No active alerts on this node.</p>
          )}
          {context && context.unresolvedIncidents.length > 0 ? (
            <>
              <h3>Unresolved incidents</h3>
              <ul className="topology-alert-list">
                {context.unresolvedIncidents.slice(0, 4).map((incident) => (
                  <li key={incident.id}>
                    <Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
                    <span className="dashboard-subtle">{incident.status}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
};
