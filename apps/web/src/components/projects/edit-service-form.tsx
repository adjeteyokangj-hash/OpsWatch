"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "../../lib/api";

type EditServiceFormProps = {
  serviceId: string;
  name: string;
  baseUrl?: string | null;
  onUpdated: () => void;
  onCancel: () => void;
};

export function EditServiceForm({ serviceId, name, baseUrl, onUpdated, onCancel }: EditServiceFormProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: name ?? "",
    baseUrl: baseUrl ?? ""
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/services/${serviceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim() || null
        })
      });
      onUpdated();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update service");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack-form billing-form-grid" onSubmit={(e) => void onSubmit(e)}>
      <div className="section-head billing-form-grid__full">
        <div>
          <h3>Edit service</h3>
          <p className="dashboard-subtle">Update the display name or Base URL used by HTTP/SSL checks.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onCancel} data-action="local-ui">
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
        />
      </label>
      <label>
        Base URL
        <input
          value={form.baseUrl}
          onChange={(e) => setForm((current) => ({ ...current, baseUrl: e.target.value }))}
          placeholder="https://api.example.com/health"
        />
      </label>
      <div className="billing-form-grid__full">
        <button type="submit" className="primary-button" disabled={saving} data-action="api" data-endpoint="/services/:serviceId">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
