"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { HealthBadge } from "../../../../components/health/health-badge";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type Service = {
  id: string;
  name: string;
  type: string;
  isCritical: boolean;
  ownerTeam?: string | null;
  runbookUrl?: string | null;
  escalationContact?: string | null;
};
type Dependency = { id: string; fromServiceId: string; toServiceId: string; dependencyType: string; criticality: string; isActive: boolean; FromService: Service; ToService: Service };
type Window = { availabilityPct?: number; errorRatePct?: number; burnRate?: number; status: string; windowMinutes?: number };
type ErrorBudget = {
  targetPct: number;
  availabilityPct: number | null;
  errorBudgetRemainingPct: number | null;
  burnRate: number | null;
  status: string;
};
type Slo = {
  id: string;
  name: string;
  serviceId?: string;
  targetType: string;
  sliType: string;
  targetPct: number;
  windowType: string;
  windowDays: number;
  latencyThresholdMs?: number;
  enabled: boolean;
  Service?: Service;
  currentWindow?: Window;
  errorBudget?: ErrorBudget;
};

const emptyDependency = { fromServiceId: "", toServiceId: "", dependencyType: "RUNTIME", criticality: "HIGH", isActive: true };
const emptySlo = { name: "", serviceId: "", targetType: "SERVICE", sliType: "AVAILABILITY", targetPct: 99.9, windowType: "ROLLING", windowDays: 30, latencyThresholdMs: 500, enabled: true };

export default function ReliabilityManagementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading: projectLoading, error: projectError } = useProjectWorkspace(projectId);
  const [services, setServices] = useState<Service[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [slos, setSlos] = useState<Slo[]>([]);
  const [dependency, setDependency] = useState<any>(emptyDependency);
  const [slo, setSlo] = useState<any>(emptySlo);
  const [editingDependency, setEditingDependency] = useState<string | null>(null);
  const [editingSlo, setEditingSlo] = useState<string | null>(null);
  const [ownershipServiceId, setOwnershipServiceId] = useState("");
  const [ownership, setOwnership] = useState({ ownerTeam: "", runbookUrl: "", escalationContact: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [serviceRows, dependencyRows, sloRows] = await Promise.all([
        apiFetch<Service[]>(`/projects/${projectId}/services`),
        apiFetch<Dependency[]>(`/projects/${projectId}/service-dependencies`),
        apiFetch<Slo[]>(`/projects/${projectId}/slos`)
      ]);
      setServices(serviceRows);
      setDependencies(dependencyRows);
      setSlos(sloRows);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load reliability configuration");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDependency = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/service-dependencies${editingDependency ? `/${editingDependency}` : ""}`, {
        method: editingDependency ? "PATCH" : "POST",
        body: JSON.stringify(dependency)
      });
      setDependency(emptyDependency);
      setEditingDependency(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not save dependency");
    }
  };

  const removeDependency = async (row: Dependency) => {
    if (!confirm(`Remove ${row.FromService.name} → ${row.ToService.name}? Dependencies already used by incident correlation must be disabled instead.`)) return;
    try {
      await apiFetch(`/projects/${projectId}/service-dependencies/${row.id}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not remove dependency");
    }
  };

  const saveSlo = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/slos${editingSlo ? `/${editingSlo}` : ""}`, {
        method: editingSlo ? "PATCH" : "POST",
        body: JSON.stringify({ ...slo, serviceId: slo.serviceId || null, targetId: slo.serviceId || projectId })
      });
      setSlo(emptySlo);
      setEditingSlo(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not save SLO");
    }
  };

  const archiveSlo = async (row: Slo) => {
    if (!confirm(`Archive ${row.name}? Burn-rate evaluation will stop and history will be retained.`)) return;
    try {
      await apiFetch(`/projects/${projectId}/slos/${row.id}`, { method: "PATCH", body: JSON.stringify({ archive: true }) });
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not archive SLO");
    }
  };

  const saveOwnership = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownershipServiceId) return;
    try {
      await apiFetch(`/services/${ownershipServiceId}/ownership`, {
        method: "PATCH",
        body: JSON.stringify({
          ownerTeam: ownership.ownerTeam || null,
          runbookUrl: ownership.runbookUrl || null,
          escalationContact: ownership.escalationContact || null
        })
      });
      await load();
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not save ownership");
    }
  };

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Dependencies & SLOs"
      subtitle="Dependency relationships and service-level objectives for this application."
      project={project}
      loading={projectLoading}
      error={projectError ?? error}
    >
      <section className="panel">
        <h2>Four-layer health model</h2>
        <div className="metric-strip">
          {(["APP", "MODULE", "WORKFLOW", "COMPONENT"] as const).map((layer) => (
            <article className="metric-card metric-card-neutral" key={layer}>
              <span className="metric-card-label">{layer === "COMPONENT" ? "Component / service" : layer.toLowerCase()}</span>
              <strong className="metric-card-value">
                {slos.filter((row) => row.targetType === layer || (layer === "COMPONENT" && row.targetType === "SERVICE")).length}
              </strong>
              <span className="metric-card-foot">SLOs</span>
            </article>
          ))}
        </div>
        <p className="dashboard-subtle">Dependencies connect monitored components. SLO scope keeps app, module, workflow and component health distinct.</p>
      </section>

      <section className="panel">
        <h2>Ownership & runbooks</h2>
        <p className="dashboard-subtle">Route ownership and runbook links for components used in automation and incident response.</p>
        <form className="stack-form reliability-form" onSubmit={saveOwnership}>
          <div className="ownership-grid">
            <label>
              Service
              <select
                required
                value={ownershipServiceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setOwnershipServiceId(id);
                  const row = services.find((service) => service.id === id);
                  setOwnership({
                    ownerTeam: row?.ownerTeam ?? "",
                    runbookUrl: row?.runbookUrl ?? "",
                    escalationContact: row?.escalationContact ?? ""
                  });
                }}
              >
                <option value="">Select…</option>
                {services.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner team
              <input value={ownership.ownerTeam} onChange={(e) => setOwnership({ ...ownership, ownerTeam: e.target.value })} />
            </label>
            <label>
              Runbook URL
              <input value={ownership.runbookUrl} onChange={(e) => setOwnership({ ...ownership, runbookUrl: e.target.value })} />
            </label>
            <label>
              Escalation contact
              <input value={ownership.escalationContact} onChange={(e) => setOwnership({ ...ownership, escalationContact: e.target.value })} />
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={!ownershipServiceId}>
            Save ownership
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Dependency relationships</h2>
        <form className="stack-form reliability-form" onSubmit={saveDependency}>
          <div className="form-grid">
            <label>
              Upstream area
              <select required value={dependency.fromServiceId} onChange={(e) => setDependency({ ...dependency, fromServiceId: e.target.value })}>
                <option value="">Select…</option>
                {services.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Downstream area
              <select required value={dependency.toServiceId} onChange={(e) => setDependency({ ...dependency, toServiceId: e.target.value })}>
                <option value="">Select…</option>
                {services.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Relationship
              <select value={dependency.dependencyType} onChange={(e) => setDependency({ ...dependency, dependencyType: e.target.value })}>
                {["HIERARCHY", "RUNTIME", "DATA", "AUTH", "QUEUE", "EXTERNAL"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Criticality
              <select value={dependency.criticality} onChange={(e) => setDependency({ ...dependency, criticality: e.target.value })}>
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <input type="checkbox" checked={dependency.isActive} onChange={(e) => setDependency({ ...dependency, isActive: e.target.checked })} /> Active for incident correlation
          </label>
          <button className="primary-button" type="submit">
            {editingDependency ? "Update relationship" : "Add relationship"}
          </button>
        </form>
        <div className="layer-health-table-wrap">
          <table className="data-table reliability-table">
            <thead>
              <tr>
                <th>Relationship</th>
                <th>Type</th>
                <th>Criticality</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dependencies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-empty">No dependency relationships configured yet.</td>
                </tr>
              ) : (
                dependencies.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.FromService.name} → {row.ToService.name}
                      </strong>
                    </td>
                    <td>{row.dependencyType}</td>
                    <td>{row.criticality}</td>
                    <td>
                      <span className={`result-pill ${row.isActive ? "pass" : "warn"}`}>{row.isActive ? "Active" : "Disabled"}</span>
                    </td>
                    <td className="table-actions">
                      <button className="secondary-button" onClick={() => { setEditingDependency(row.id); setDependency(row); }}>
                        Edit
                      </button>
                      <button className="danger-button" onClick={() => void removeDependency(row)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Service-level objectives</h2>
        <form className="stack-form reliability-form" onSubmit={saveSlo}>
          <div className="form-grid">
            <label>
              Name
              <input required value={slo.name} onChange={(e) => setSlo({ ...slo, name: e.target.value })} />
            </label>
            <label>
              Health layer
              <select value={slo.targetType} onChange={(e) => setSlo({ ...slo, targetType: e.target.value })}>
                {["APP", "MODULE", "WORKFLOW", "COMPONENT", "SERVICE"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Monitored area
              <select value={slo.serviceId} onChange={(e) => setSlo({ ...slo, serviceId: e.target.value })}>
                <option value="">Whole app / logical area</option>
                {services.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              SLI
              <select value={slo.sliType} onChange={(e) => setSlo({ ...slo, sliType: e.target.value })}>
                {["AVAILABILITY", "ERROR_RATE", "LATENCY"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Objective %
              <input type="number" min="0.001" max="100" step="0.001" value={slo.targetPct} onChange={(e) => setSlo({ ...slo, targetPct: Number(e.target.value) })} />
            </label>
            <label>
              Window type
              <select value={slo.windowType} onChange={(e) => setSlo({ ...slo, windowType: e.target.value, windowDays: e.target.value === "CALENDAR" ? 30 : 30 })}>
                <option>ROLLING</option>
                <option>CALENDAR</option>
              </select>
            </label>
            <label>
              Window
              <select value={slo.windowDays} onChange={(e) => setSlo({ ...slo, windowDays: Number(e.target.value) })}>
                {(slo.windowType === "CALENDAR" ? [7, 30, 90, 365] : [1, 7, 14, 28, 30, 90]).map((v) => (
                  <option key={v} value={v}>
                    {v} days
                  </option>
                ))}
              </select>
            </label>
            {slo.sliType === "LATENCY" ? (
              <label>
                Latency threshold ms
                <input type="number" min="1" value={slo.latencyThresholdMs} onChange={(e) => setSlo({ ...slo, latencyThresholdMs: Number(e.target.value) })} />
              </label>
            ) : null}
          </div>
          <label>
            <input type="checkbox" checked={slo.enabled} onChange={(e) => setSlo({ ...slo, enabled: e.target.checked })} /> Enable burn-rate evaluation
          </label>
          <button className="primary-button" type="submit">
            {editingSlo ? "Update SLO" : "Create SLO"}
          </button>
        </form>
        <div className="layer-health-table-wrap">
          <table className="data-table reliability-table">
            <thead>
              <tr>
                <th>SLO</th>
                <th>Scope</th>
                <th>Objective</th>
                <th>Compliance</th>
                <th>Error budget</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">No SLOs configured yet.</td>
                </tr>
              ) : (
                slos.map((row) => {
                  const compliance = row.currentWindow?.availabilityPct;
                  const budget = row.errorBudget?.errorBudgetRemainingPct;
                  const status = row.currentWindow?.status || (row.enabled ? "AWAITING DATA" : "DISABLED");
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <div className="table-subtle">
                          {row.sliType} · {row.windowType} {row.windowDays}d
                        </div>
                      </td>
                      <td>
                        {row.targetType} · {row.Service?.name || "Project-wide"}
                      </td>
                      <td>{row.targetPct}%</td>
                      <td>{compliance == null ? "—" : `${compliance.toFixed(2)}%`}</td>
                      <td>
                        {budget == null ? "—" : `${budget.toFixed(1)}% remaining`}
                        {row.errorBudget?.burnRate != null ? (
                          <div className="table-subtle">burn {row.errorBudget.burnRate.toFixed(2)}×</div>
                        ) : null}
                      </td>
                      <td>
                        <HealthBadge status={status === "HEALTHY" ? "HEALTHY" : status === "DISABLED" ? "PAUSED" : "DEGRADED"} displayLabel={status} />
                      </td>
                      <td className="table-actions">
                        <button className="secondary-button" onClick={() => { setEditingSlo(row.id); setSlo(row); }}>
                          Edit
                        </button>
                        <button className="danger-button" onClick={() => void archiveSlo(row)}>
                          Archive
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </ProjectWorkspaceShell>
  );
}
