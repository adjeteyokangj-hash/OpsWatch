"use client";

import Link from "next/link";
import { useState } from "react";
import { HealthBadge } from "../health/health-badge";
import { EditServiceForm } from "./edit-service-form";

const layerIcon = (type: string): string => {
  if (type === "MODULE") return "▣";
  if (type === "WORKFLOW") return "↻";
  if (type === "API") return "⚡";
  if (type === "DATABASE") return "🗄";
  if (type === "WEBHOOK") return "🔗";
  if (type === "EMAIL") return "✉";
  if (type === "PAYMENT") return "£";
  return "◎";
};

export const usesInheritedApplicationHeartbeat = (row: any): boolean =>
  row?.type === "MODULE" && (!Array.isArray(row?.Check) || row.Check.length === 0);

export const serviceCardHealthLabel = (row: any): string | null => {
  if (!usesInheritedApplicationHeartbeat(row)) return null;
  if (typeof row.healthDisplayLabel === "string" && row.healthDisplayLabel.trim()) {
    return row.healthDisplayLabel.trim();
  }
  if (row.status === "HEALTHY") return "Application signal active";
  if (row.status === "DEGRADED") return "Application signal delayed";
  if (row.status === "DOWN" || row.status === "CRITICAL") return "Application signal down";
  if (row.status === "PAUSED") return "Monitoring paused";
  return "Awaiting live signal";
};

const statusHint = (row: any): string => {
  if (usesInheritedApplicationHeartbeat(row)) {
    if (row.healthSource === "CONNECTION_DISCOVERY") {
      if (typeof row.healthReason === "string" && row.healthReason.trim()) {
        return row.healthReason.trim();
      }
      if (row.status === "HEALTHY") {
        return "Authenticated application discovery is responding; add module checks for deeper health evidence.";
      }
      if (row.status === "DEGRADED") {
        return "The authenticated application connection is overdue or needs attention.";
      }
      return "Waiting for a successful authenticated application connection check.";
    }

    if (row.healthSource === "HEARTBEAT") {
      if (row.status === "HEALTHY") {
        return "Live through the application heartbeat; add module checks for deeper health evidence.";
      }
      if (row.status === "DEGRADED") {
        return "The inherited application heartbeat is delayed or degraded.";
      }
      if (row.status === "DOWN" || row.status === "CRITICAL") {
        return "The application heartbeat reports this module unavailable.";
      }
      if (row.status === "PAUSED") return "Application heartbeat monitoring is paused.";
      return "Waiting for the next application heartbeat.";
    }

    if (row.status === "HEALTHY") {
      return "The application is responding; add module checks for deeper health evidence.";
    }
    if (row.status === "DEGRADED") return "The inherited application signal needs attention.";
    if (row.status === "DOWN" || row.status === "CRITICAL") return "The application signal reports this module unavailable.";
    if (row.status === "PAUSED") return "Application monitoring is paused.";
    return "Waiting for a live application signal.";
  }
  if (row.status === "HEALTHY") return "Operating normally";
  if (row.status === "DEGRADED") return "Needs attention";
  if (row.status === "DOWN" || row.status === "CRITICAL") return "Action required";
  return "Waiting for first monitoring signal";
};

const targetLabel = (row: any): string => {
  if (row.baseUrl) return row.baseUrl;
  if (row.type === "MODULE") return "Logical application module";
  return "No target URL";
};

export type ServiceCardPrimaryCta = {
  label: string;
  hrefFor: (serviceId: string) => string;
  ariaLabelFor: (name: string) => string;
};

export function ServiceCardGrid({
  rows,
  projectId,
  onUpdated,
  primaryCta
}: {
  rows: Array<any>;
  projectId: string;
  onUpdated?: () => void;
  /** Primary link after Edit. Defaults to checks console for non-module layers. */
  primaryCta?: ServiceCardPrimaryCta;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const cta: ServiceCardPrimaryCta = primaryCta ?? {
    label: "View checks →",
    hrefFor: (serviceId) => `/checks?projectId=${projectId}&serviceId=${serviceId}`,
    ariaLabelFor: (name) => `View checks for ${name}`
  };

  if (rows.length === 0) {
    return (
      <div className="workspace-empty-inline">
        <p>No items in this layer yet.</p>
        <p className="dashboard-subtle">
          Use <strong>Add service</strong> above to register the first one.
        </p>
      </div>
    );
  }

  const editing = editingId ? rows.find((row) => row.id === editingId) : null;

  return (
    <div>
      {editing ? (
        <div style={{ marginBottom: "1rem" }}>
          <EditServiceForm
            serviceId={editing.id}
            name={editing.name}
            baseUrl={editing.baseUrl}
            onCancel={() => setEditingId(null)}
            onUpdated={() => {
              setEditingId(null);
              onUpdated?.();
            }}
          />
        </div>
      ) : null}
      <div className="service-card-grid">
        {rows.map((row) => (
          <article className="service-card" key={row.id}>
            <div className="service-card-top">
              <span className="service-card-icon" aria-hidden="true">
                {layerIcon(row.type)}
              </span>
              <HealthBadge status={row.status} displayLabel={serviceCardHealthLabel(row)} />
            </div>
            <h3>{row.name}</h3>
            <p className="service-card-meta">
              <span>{row.type}</span>
              {row.isCritical ? <span className="criticality-tag">Critical</span> : null}
            </p>
            <p className="service-card-hint">{targetLabel(row)}</p>
            <p className="service-card-hint">{statusHint(row)}</p>
            <div className="table-actions service-card-actions">
              <button
                type="button"
                className="text-link"
                onClick={() => setEditingId(row.id)}
                data-action="local-ui"
                aria-label={`Edit ${row.name}`}
              >
                Edit
              </button>
              <span className="service-card-actions-sep" aria-hidden="true">
                ·
              </span>
              <Link
                className="service-card-link"
                href={cta.hrefFor(row.id)}
                aria-label={cta.ariaLabelFor(row.name)}
              >
                {cta.label}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
