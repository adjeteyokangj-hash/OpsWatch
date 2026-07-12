"use client";

import { useState } from "react";
import Link from "next/link";
import type { LayerImpact, LayerImpactStatus } from "./incident-diagnosis-types";
import { layerLabel, serviceDetailHref, statusLabel } from "./incident-diagnosis-types";

type Props = {
  layerImpacts: LayerImpact[];
  projectId?: string;
};

const IMPACT_ORDER: Record<LayerImpactStatus, number> = {
  ROOT_CAUSE: 0,
  AFFECTED: 1,
  DEGRADED: 2,
  UNAFFECTED: 3
};

const statusRowClass = (status: LayerImpactStatus): string => {
  if (status === "ROOT_CAUSE") return "impact-row root-cause";
  if (status === "AFFECTED") return "impact-row affected";
  if (status === "DEGRADED") return "impact-row degraded";
  return "impact-row unaffected";
};

export function IncidentLayerImpactPanel({ layerImpacts, projectId }: Props) {
  const [showUnaffected, setShowUnaffected] = useState(false);

  if (layerImpacts.length === 0) return null;

  const affected = layerImpacts
    .filter((row) => row.status !== "UNAFFECTED")
    .sort((a, b) => IMPACT_ORDER[a.status] - IMPACT_ORDER[b.status] || a.serviceName.localeCompare(b.serviceName));

  const unaffected = layerImpacts
    .filter((row) => row.status === "UNAFFECTED")
    .sort((a, b) => a.layer.localeCompare(b.layer) || a.serviceName.localeCompare(b.serviceName));

  return (
    <section className="panel incident-layer-impact-panel">
      <h2>Four-layer impact</h2>
      <div className="impact-table-wrap">
        <table className="impact-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Status</th>
              <th>Area</th>
            </tr>
          </thead>
          <tbody>
            {affected.map((row) => (
              <tr key={row.serviceId} className={statusRowClass(row.status)}>
                <td>{layerLabel(row.layer)}</td>
                <td><span className="impact-status-pill">{statusLabel(row.status)}</span></td>
                <td>
                  <Link href={serviceDetailHref(row.serviceId, projectId)}>{row.serviceName}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unaffected.length > 0 ? (
        <div className="impact-unaffected-section">
          <button
            type="button"
            className="secondary-button impact-unaffected-toggle"
            onClick={() => setShowUnaffected((value) => !value)}
            aria-expanded={showUnaffected}
          >
            {showUnaffected ? "Hide" : "Show"} unaffected areas ({unaffected.length})
          </button>
          {showUnaffected ? (
            <div className="impact-table-wrap">
              <table className="impact-table impact-table-muted">
                <tbody>
                  {unaffected.map((row) => (
                    <tr key={row.serviceId} className={statusRowClass(row.status)}>
                      <td>{layerLabel(row.layer)}</td>
                      <td><span className="impact-status-pill">{statusLabel(row.status)}</span></td>
                      <td>
                        <Link href={serviceDetailHref(row.serviceId, projectId)}>{row.serviceName}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
