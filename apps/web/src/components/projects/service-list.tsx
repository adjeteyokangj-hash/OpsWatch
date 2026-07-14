"use client";

import Link from "next/link";
import { useState } from "react";
import { HealthBadge } from "../health/health-badge";
import { EditServiceForm } from "./edit-service-form";

const layerTone = (type: string): string => {
  if (type === "APP") return "app";
  if (type === "MODULE") return "module";
  if (type === "WORKFLOW") return "workflow";
  return "component";
};

export function ServiceList({
  rows,
  projectId,
  onUpdated
}: {
  rows: Array<any>;
  projectId?: string;
  onUpdated?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="workspace-empty-inline">
        <p>No services in this layer yet.</p>
        <p className="dashboard-subtle">
          Use <strong>Add service</strong> above, then attach checks from the Checks tab.
        </p>
      </div>
    );
  }

  const editing = editingId ? rows.find((row) => row.id === editingId) : null;

  return (
    <div className="layer-health-table-wrap">
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
      <table className="data-table service-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Layer</th>
            <th>Base URL</th>
            <th>Health</th>
            <th>Criticality</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td data-label="Name">
                <strong>{row.name}</strong>
              </td>
              <td data-label="Layer">
                <span className={`layer-tag ${layerTone(row.type)}`}>{row.type}</span>
              </td>
              <td data-label="Base URL">
                <span className="dashboard-subtle">{row.baseUrl || "No target URL"}</span>
              </td>
              <td data-label="Health">
                <HealthBadge status={row.status} />
              </td>
              <td data-label="Criticality">
                {row.isCritical ? <span className="criticality-tag">Critical</span> : <span className="dashboard-subtle">Standard</span>}
              </td>
              <td data-label="Actions">
                <div className="table-actions">
                  <button type="button" className="text-link" onClick={() => setEditingId(row.id)} data-action="local-ui">
                    Edit
                  </button>
                  {projectId ? (
                    <Link className="text-link" href={`/checks?projectId=${projectId}&serviceId=${row.id}`}>
                      View checks
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
