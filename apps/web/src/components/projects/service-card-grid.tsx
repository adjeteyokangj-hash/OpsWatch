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

const statusHint = (status: string): string => {
  if (status === "HEALTHY") return "Operating normally";
  if (status === "DEGRADED") return "Needs attention";
  if (status === "DOWN" || status === "CRITICAL") return "Action required";
  return "Waiting for first heartbeat";
};

export function ServiceCardGrid({
  rows,
  projectId,
  onUpdated
}: {
  rows: Array<any>;
  projectId: string;
  onUpdated?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

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
              <HealthBadge status={row.status} />
            </div>
            <h3>{row.name}</h3>
            <p className="service-card-meta">
              <span>{row.type}</span>
              {row.isCritical ? <span className="criticality-tag">Critical</span> : null}
            </p>
            <p className="service-card-hint">{row.baseUrl || "No target URL"}</p>
            <p className="service-card-hint">{statusHint(row.status)}</p>
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
                href={`/checks?projectId=${projectId}&serviceId=${row.id}`}
                aria-label={`View checks for ${row.name}`}
              >
                View checks →
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
