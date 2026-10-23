"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProjectCatalogue, CatalogueAssignment } from "@opswatch/shared";
import { apiFetch } from "../../lib/api";

export function ModuleCataloguePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectWebsite, setInspectWebsite] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const activeProject = useRef(projectId);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    if (activeProject.current !== projectId) return;
    const version = ++requestVersion.current;
    try {
      const payload = await apiFetch<ProjectCatalogue>(`/projects/${encodeURIComponent(projectId)}/module-catalogue`);
      if (activeProject.current !== projectId || version !== requestVersion.current) return;
      if (!payload || !Array.isArray(payload.catalogue) || !Array.isArray(payload.assignments)) throw new Error("Catalogue response was incomplete. Retry after checking API availability.");
      setData(payload); setError(null);
    }
    catch (err) { if (activeProject.current === projectId && version === requestVersion.current) setError(err instanceof Error ? err.message : "Catalogue could not be loaded"); }
  }, [projectId]);
  useEffect(() => {
    activeProject.current = projectId; setData(null); setError(null); setNotes({}); void load();
    return () => { activeProject.current = ""; };
  }, [load, projectId]);
  const mutate = async (key?: string, state?: string, assignment?: CatalogueAssignment) => {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/projects/${encodeURIComponent(projectId)}/module-catalogue/${key ? encodeURIComponent(key) : "analyse"}`, {
        method: key ? "PUT" : "POST",
        body: JSON.stringify(key ? { state, expectedUpdatedAt: assignment?.updatedAt, note: notes[key] ?? assignment?.note ?? undefined } : { inspectWebsite, useAi })
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Module action failed"); }
    finally { setBusy(false); }
  };
  const bind = async (assignment: CatalogueAssignment, entityId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/projects/${encodeURIComponent(projectId)}/module-catalogue/${assignment.moduleKey}/component`, {
        method: "PUT", body: JSON.stringify({ entityId: entityId || null, expectedUpdatedAt: assignment.updatedAt })
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Component binding failed"); }
    finally { setBusy(false); }
  };
  return <section className="panel module-catalogue-panel" aria-label="Module catalogue and assignments">
    <h2>Module catalogue and assignments</h2>
    <p>Approve relevant modules for this application. Approval records owner intent. Installed components and operational health require separate verified evidence.</p>
    <Link href="/module-catalogue">Browse and manage the catalogue</Link>{" · "}
    <Link href={`/projects/${projectId}/topology`}>View verified topology</Link>
    {error && <p role="alert" className="error-panel">{error} <button onClick={() => void load()}>Retry</button></p>}
    {!data && !error && <p role="status">Loading catalogue…</p>}
    {data?.discovery && <p role="status">Discovery: {data.discovery.state}. Method: {data.discovery.method ?? "Unknown"}. AI: {data.discovery.aiState ?? "Unknown"}.
      {data.discovery.missingSources?.length ? ` Missing evidence: ${data.discovery.missingSources.join(", ")}.` : ""}
    </p>}
    {data?.proposals && data.proposals.length > 0 && <div className="module-catalogue-hints" role="region" aria-label="Applicability hints">
      <h3>Applicability hints</h3>
      <p>These are read-only matches from the stored application description and configured public URL. They are not assignments, installed modules or health evidence. Run analysis to persist proposals for review.</p>
      <ul>{data.proposals.map(hint => <li key={hint.key}><strong>{hint.label}</strong> · {hint.state} · {hint.sources.join(", ")}</li>)}</ul>
    </div>}
    {data?.canManage && <div className="module-catalogue-controls">
      <label className="module-catalogue-choice"><input type="checkbox" checked={inspectWebsite} onChange={event => setInspectWebsite(event.target.checked)} />Inspect metadata from this application’s configured public website</label>
      <label className="module-catalogue-choice"><input type="checkbox" checked={useAi} onChange={event => setUseAi(event.target.checked)} />Use configured AI to recommend modules from the collected evidence</label>
      <button className="primary-button" disabled={busy} onClick={() => void mutate()}>{busy ? "Working…" : "Analyse module evidence"}</button>
      <p>Analysis uses stored application information and fresh authorised API imports. Website inspection is optional. Reanalysis preserves owner decisions.</p>
    </div>}
    {data && <div className="table-scroll"><table className="data-table"><thead><tr><th>Module</th><th>Assignment</th><th>Evidence</th><th>Review</th></tr></thead>
      <tbody>{data.catalogue.map(definition => {
        const assignment = data.assignments.find(row => row.moduleKey === definition.key);
        return <tr key={definition.key}>
          <td><strong>{definition.label}</strong><p>{definition.description}</p><small>{definition.source} · {definition.category} · v{definition.version}</small></td>
          <td><span>{assignment?.state ?? "Not assigned"}</span>{assignment && <p>{assignment.source === "OWNER" ? "Owner decision recorded" : `${Math.round(assignment.confidence * 100)}% confidence in applicability`}</p>}
            {assignment?.state === "APPROVED" && <label>Existing topology component
              <select aria-label={`Topology component for ${definition.label}`} disabled={!data.canManage || busy} value={assignment.verifiedEntityId ?? ""} onChange={event => void bind(assignment, event.target.value)}>
                <option value="">Unbound</option>{data.verifiedComponents?.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                {assignment.verifiedEntityId && !data.verifiedComponents?.some(entity => entity.id === assignment.verifiedEntityId) &&
                  <option value={assignment.verifiedEntityId}>Previously bound component is no longer verified</option>}
              </select><small>Binding records identity. Live health and freshness remain in topology.</small>
            </label>}
          </td>
          <td>{assignment?.evidenceJson?.map((item, index) => <p key={index}>{item.source}: {item.reason}{item.reference && <small> Source: {item.reference}</small>}</p>) ?? "No stored evidence"}</td>
          <td>{data.canManage ? <div className="module-catalogue-actions">
            <label>Owner note <input aria-label={`Owner note for ${definition.label}`} maxLength={500}
              value={notes[definition.key] ?? assignment?.note ?? ""}
              onChange={event => setNotes(current => ({ ...current, [definition.key]: event.target.value }))} /></label>
            <button className="primary-button" disabled={busy || assignment?.state === "APPROVED" || definition.status !== "ACTIVE"} onClick={() => void mutate(definition.key, "APPROVED", assignment)}>Approve</button>
            <button className="secondary-button" disabled={busy || assignment?.state === "REJECTED"} onClick={() => void mutate(definition.key, "REJECTED", assignment)}>Reject</button>
            {assignment && <button className="secondary-button" disabled={busy || assignment.state === "REMOVED"} onClick={() => void mutate(definition.key, "REMOVED", assignment)}>Remove assignment</button>}
            {assignment && assignment.state !== "PROPOSED" && <button className="secondary-button" disabled={busy} onClick={() => void mutate(definition.key, assignment.state, assignment)}>Save note</button>}
          </div> : <>{assignment?.note && <p>{assignment.note}</p>}Administrator review required</>}</td>
        </tr>;
      })}</tbody></table></div>}
  </section>;
}
