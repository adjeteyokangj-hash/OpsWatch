"use client";

import { FormEvent, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

const componentTypes = [
  "COMPONENT",
  "FRONTEND",
  "API",
  "DATABASE",
  "WORKER",
  "WEBHOOK",
  "EMAIL",
  "PAYMENT",
  "THIRD_PARTY"
] as const;

type LayerKey = "modules" | "workflows" | "components";

const defaultTypeForLayer = (layerKey: LayerKey): string => {
  if (layerKey === "modules") return "MODULE";
  if (layerKey === "workflows") return "WORKFLOW";
  return "API";
};

export function AddServiceForm({
  projectId,
  layerKey,
  onCreated
}: {
  projectId: string;
  layerKey: LayerKey;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: defaultTypeForLayer(layerKey),
    baseUrl: "",
    isCritical: false
  });

  const typeOptions = useMemo(() => {
    if (layerKey === "modules") return ["MODULE"];
    if (layerKey === "workflows") return ["WORKFLOW"];
    return [...componentTypes];
  }, [layerKey]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/services`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          baseUrl: form.baseUrl.trim() || null,
          isCritical: form.isCritical
        })
      });
      setForm({
        name: "",
        type: defaultTypeForLayer(layerKey),
        baseUrl: "",
        isCritical: false
      });
      setOpen(false);
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create service");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="primary-button" onClick={() => setOpen(true)} data-action="local-ui">
        + Add service
      </button>
    );
  }

  return (
    <form className="stack-form billing-form-grid" onSubmit={(e) => void onSubmit(e)}>
      <div className="section-head billing-form-grid__full">
        <div>
          <h3>Add service</h3>
          <p className="dashboard-subtle">Services belong to this project and can have checks attached on the Checks page.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen(false)} data-action="local-ui">
          Cancel
        </button>
      </div>
      {error ? <p className="billing-form-grid__full error-panel">{error}</p> : null}
      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
          required
          placeholder="Payments API"
        />
      </label>
      <label>
        Type
        <select
          value={form.type}
          onChange={(e) => setForm((current) => ({ ...current, type: e.target.value }))}
          disabled={layerKey !== "components"}
        >
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base URL (optional)
        <input
          value={form.baseUrl}
          onChange={(e) => setForm((current) => ({ ...current, baseUrl: e.target.value }))}
          placeholder="https://api.example.com/health"
        />
      </label>
      <label className="billing-form-grid__full">
        <input
          type="checkbox"
          checked={form.isCritical}
          onChange={(e) => setForm((current) => ({ ...current, isCritical: e.target.checked }))}
        />{" "}
        Mark as critical service
      </label>
      <div className="billing-form-grid__full">
        <button type="submit" className="primary-button" disabled={saving} data-action="api" data-endpoint="/projects/:id/services">
          {saving ? "Creating…" : "Create service"}
        </button>
      </div>
    </form>
  );
}
