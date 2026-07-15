"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ProviderConfigForm } from "../../../../../components/integrations/provider-config-form";
import { ProviderDashboard } from "../../../../../components/integrations/provider-dashboard";
import { ProjectWorkspaceShell } from "../../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../../lib/api";
import {
  parseIntegrationType,
  providerDisplayName,
  PROVIDER_PRESETS,
  type IntegrationType,
  type ProjectIntegration
} from "../../../../../lib/integrations";

type IntegrationDraft = {
  enabled: boolean;
  name: string;
  secretRef: string;
  configJson: Record<string, unknown>;
};

const safeReturnPath = (value: string | null): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

export default function ProviderIntegrationDetailPage() {
  const params = useParams<{ projectId: string; provider: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const { project, loading: projectLoading, error: projectError } = useProjectWorkspace(params.projectId);
  const providerType = useMemo(() => parseIntegrationType(params.provider || "webhook"), [params.provider]);
  const preset = useMemo(() => PROVIDER_PRESETS[providerType] ?? {}, [providerType]);

  useEffect(() => {
    if (providerType === "STRIPE") {
      router.replace("/admin/billing/stripe");
    }
  }, [providerType, router]);

  const [integration, setIntegration] = useState<ProjectIntegration | null>(null);
  const [draft, setDraft] = useState<IntegrationDraft>({
    enabled: true,
    name: "",
    secretRef: "",
    configJson: preset
  });
  const [advancedJson, setAdvancedJson] = useState(JSON.stringify(preset, null, 2));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!params.projectId || !providerType) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await apiFetch<ProjectIntegration[]>(
          `/settings/integrations?projectId=${encodeURIComponent(params.projectId)}`
        );
        const match = rows.find(
          (row) => row.projectId === params.projectId && row.type.toUpperCase() === providerType
        );

        const mergedConfig = {
          ...preset,
          ...(match?.configJson ?? {})
        };

        setIntegration(match || null);
        setDraft({
          enabled: match?.enabled ?? true,
          name: match?.name ?? `${providerDisplayName(providerType)} integration`,
          secretRef: match?.secretRef ?? "",
          configJson: mergedConfig
        });
        setAdvancedJson(JSON.stringify(mergedConfig, null, 2));
      } catch (loadError: any) {
        setError(loadError?.message || "Failed to load integration");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [params.projectId, providerType, preset]);

  const setConfigValue = (key: string, value: string) => {
    setDraft((current) => {
      const nextConfig = {
        ...current.configJson,
        [key]: value
      };
      setAdvancedJson(JSON.stringify(nextConfig, null, 2));
      return {
        ...current,
        configJson: nextConfig
      };
    });
  };

  const persistIntegration = async (configJson = draft.configJson) => {
    const saved = await apiFetch<ProjectIntegration>(`/settings/integrations/${params.projectId}/${providerType}`, {
      method: "PUT",
      body: JSON.stringify({
        enabled: draft.enabled,
        name: draft.name || undefined,
        secretRef: draft.secretRef || undefined,
        configJson
      })
    });

    setIntegration(saved);
    setDraft((current) => ({
      ...current,
      enabled: saved.enabled,
      name: saved.name ?? current.name,
      secretRef: saved.secretRef ?? current.secretRef,
      configJson: {
        ...preset,
        ...(saved.configJson ?? configJson)
      }
    }));
    setAdvancedJson(JSON.stringify({ ...preset, ...(saved.configJson ?? configJson) }, null, 2));
    return saved;
  };

  const saveConfiguration = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await persistIntegration();
      setMessage("Configuration saved. Validate the connection to confirm health.");
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const validateConnection = async () => {
    setValidating(true);
    setError(null);
    setMessage(null);

    try {
      await persistIntegration();
      const validated = await apiFetch<ProjectIntegration>(
        `/settings/integrations/${params.projectId}/${providerType}/validate`,
        { method: "POST" }
      );
      setIntegration(validated);
      setMessage(
        validated.validationStatus === "VALID"
          ? validated.validationMessage || "Successfully connected."
          : validated.validationMessage || "Validation failed. Review the missing fields and try again."
      );
    } catch (validateError: any) {
      setError(validateError?.message || "Failed to validate connection");
    } finally {
      setValidating(false);
    }
  };

  const disconnectIntegration = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const clearedPreset = { ...preset };
      setDraft((current) => ({
        ...current,
        secretRef: "",
        configJson: clearedPreset
      }));
      setAdvancedJson(JSON.stringify(clearedPreset, null, 2));

      const saved = await apiFetch<ProjectIntegration>(`/settings/integrations/${params.projectId}/${providerType}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: false,
          name: draft.name || undefined,
          secretRef: undefined,
          configJson: clearedPreset
        })
      });
      setIntegration(saved);
      setMessage("Integration disconnected.");
    } catch (disconnectError: any) {
      setError(disconnectError?.message || "Failed to disconnect integration");
    } finally {
      setSaving(false);
    }
  };

  const handleAdvancedJsonChange = (value: string) => {
    setAdvancedJson(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setDraft((current) => ({ ...current, configJson: parsed as Record<string, unknown> }));
        setError(null);
      }
    } catch {
      setError("Advanced JSON is not valid yet.");
    }
  };

  if (providerType === "STRIPE") {
    return null;
  }

  return (
    <ProjectWorkspaceShell
      projectId={params.projectId}
      title={project ? `${project.name} — ${providerDisplayName(providerType)}` : `Integration: ${providerDisplayName(providerType)}`}
      subtitle="Configure provider connectivity, validate health, and monitor connection status."
      project={project}
      loading={projectLoading}
      error={projectError}
    >
      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel success-panel">{message}</section> : null}
      {returnTo ? (
        <aside className="notice-panel" role="status" data-testid="integration-return-banner">
          <strong>Return to topology</strong>
          <p>
            After this remediator validates as connected, return to the relationship drawer to re-evaluate Fix with
            automation.
          </p>
          <Link className="secondary-button" href={returnTo} data-testid="integration-return-link">
            ← Back to topology
          </Link>
        </aside>
      ) : null}

      <section className="two-col settings-grid provider-layout">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Connection settings</h2>
              <p>{loading ? "Loading integration..." : "Save credentials and provider settings, then validate the connection."}</p>
            </div>
          </div>

          <form className="stack-form" onSubmit={saveConfiguration}>
            <ProviderConfigForm
              type={providerType as IntegrationType}
              enabled={draft.enabled}
              name={draft.name}
              secretRef={draft.secretRef}
              configJson={draft.configJson}
              showAdvanced={showAdvanced}
              advancedJson={advancedJson}
              onEnabledChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              onNameChange={(name) => setDraft((current) => ({ ...current, name }))}
              onSecretRefChange={(secretRef) => setDraft((current) => ({ ...current, secretRef }))}
              onConfigValueChange={setConfigValue}
              onAdvancedJsonChange={handleAdvancedJsonChange}
              onToggleAdvanced={() => setShowAdvanced((current) => !current)}
            />

            <div className="provider-flow">
              <div className="provider-flow__step">1. Save configuration</div>
              <div className="provider-flow__arrow">↓</div>
              <div className="provider-flow__step provider-flow__step--primary">2. Validate connection</div>
              <div className="provider-flow__arrow">↓</div>
              <div className="provider-flow__step">3. Connected</div>
            </div>

            <div className="channel-actions">
              <button type="submit" className="secondary-button" disabled={saving || validating}>
                {saving ? "Saving..." : "Save configuration"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void validateConnection()}
                disabled={saving || validating}
              >
                {validating ? "Validating..." : "Validate connection"}
              </button>
            </div>
          </form>
        </section>

        <div className="provider-layout__aside">
          <ProviderDashboard
            providerName={providerDisplayName(providerType)}
            integration={integration}
            validating={validating}
            onValidate={() => void validateConnection()}
            onDisconnect={() => void disconnectIntegration()}
            disableActions={saving || validating}
          />

          <aside className="panel">
            <h2>Setup guide</h2>
            {providerType === "WEBHOOK" ? (
              <>
                <p>Ask the client for a public HTTPS webhook URL that accepts OpsWatch events.</p>
                <ol className="client-fix-list">
                  <li>Paste the endpoint into Webhook URL.</li>
                  <li>Save configuration, then validate connectivity.</li>
                  <li>Use Advanced configuration only if you manage secrets in an external vault.</li>
                </ol>
              </>
            ) : (
              <p>Fill in the connection settings and validate before relying on this provider for alerts or automation.</p>
            )}

            <Link className="secondary-button" href={returnTo ?? `/projects/${params.projectId}`}>
              {returnTo ? "← Back to topology" : "Back to project"}
            </Link>
          </aside>
        </div>
      </section>
    </ProjectWorkspaceShell>
  );
}
