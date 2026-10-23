"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { CatalogueDefinition } from "@opswatch/shared";
import { Shell } from "../../components/layout/shell";
import { apiFetch } from "../../lib/api";

export default function ModuleCataloguePage() {
  const [definitions, setDefinitions] = useState<CatalogueDefinition[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CatalogueDefinition | null>(null);
  const load = async () => {
    try {
      const payload = await apiFetch<{ catalogue: CatalogueDefinition[]; canManage: boolean }>("/module-catalogue");
      setDefinitions(payload.catalogue); setCanManage(payload.canManage); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Catalogue could not be loaded"); }
  };
  useEffect(() => { void load(); }, []);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    try {
      await apiFetch(editing ? `/module-catalogue/${editing.key}` : "/module-catalogue", { method: editing ? "PUT" : "POST", body: JSON.stringify({
        key: values.get("key"), label: values.get("label"), description: values.get("description"), category: values.get("category"),
        terms: String(values.get("terms")).split(",").map(term => term.trim()).filter(Boolean),
        capabilities: String(values.get("capabilities") ?? "").split(",").map(term => term.trim()).filter(Boolean),
        ...(editing ? { expectedVersion: editing.version, status: values.get("status") } : {})
      }) });
      form.reset(); setEditing(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Module could not be created"); }
    finally { setBusy(false); }
  };
  return <Shell><section className="panel module-catalogue-panel">
    <h1>Module catalogue</h1>
    <p>Explore platform and organisation modules. Assignments belong to individual applications and do not establish installed components or monitoring.</p>
    <Link href="/projects">Open an application to review module assignments</Link>
    {error && <p role="alert">{error} <button onClick={() => void load()}>Retry</button></p>}
    <label>Search modules <input value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Module</th><th>Category</th><th>Capabilities</th><th>Source</th></tr></thead><tbody>
      {definitions.filter(row => `${row.label} ${row.description} ${row.category}`.toLowerCase().includes(search.toLowerCase())).map(row => <tr key={row.key}>
        <td><strong>{row.label}</strong><p>{row.description}</p></td><td>{row.category}</td><td>{row.capabilities.join(", ")}</td><td>{row.source} · v{row.version} · {row.status}{canManage && row.source === "CUSTOM" && <button onClick={() => setEditing(row)}>Edit {row.label}</button>}</td>
      </tr>)}
    </tbody></table></div>
    {canManage && <form className="module-definition-form" key={editing?.key ?? "new"} onSubmit={event => void create(event)}><h2>{editing ? "Edit organisation module" : "Add an organisation module"}</h2>
      <label>Stable key <input name="key" required readOnly={Boolean(editing)} defaultValue={editing?.key} pattern="[a-z][a-z0-9_]{1,63}" maxLength={64} /></label>
      <label>Name <input name="label" required defaultValue={editing?.label} minLength={2} maxLength={100} /></label>
      <label>Description <textarea name="description" required defaultValue={editing?.description} minLength={5} maxLength={1000} /></label>
      <label>Category <input name="category" required defaultValue={editing?.category} minLength={2} maxLength={50} /></label>
      <label>Discovery terms separated by commas <input name="terms" required defaultValue={editing?.terms?.join(", ")} /></label>
      <label>Capabilities separated by commas <input name="capabilities" defaultValue={editing?.capabilities?.join(", ")} /></label>
      {editing && <label>Status <select name="status" aria-label="Module status" defaultValue={editing.status}><option>ACTIVE</option><option>ARCHIVED</option></select></label>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save module" : "Add custom module"}</button>
      {editing && <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel editing</button>}
    </form>}
  </section></Shell>;
}
