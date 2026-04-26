"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../../../components/layout/shell";
import { Header } from "../../../../../components/layout/header";
import { apiFetch } from "../../../../../lib/api";

type IntegrationValidationStatus = "UNKNOWN" | "VALID" | "INVALID";

type ProjectIntegration = {
  id: string;
  projectId: string;
  type: string;
  name: string | null;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  secretRef: string | null;
  validationStatus: IntegrationValidationStatus;
  validationMessage: string | null;
  lastValidatedAt: string | null;
};

type IntegrationDraft = {
  enabled: boolean;
  name: string;
  secretRef: string;
  configJson: Record<string, unknown>;
};

const PROVIDER_PRESETS: Record<string, Record<string, unknown>> = {
  WEBHOOK: {
    WEBHOOK_URL: "",
    WEBHOOK_TIMEOUT_MS: 5000,
    WEBHOOK_SIGNING_HEADER: "X-OpsWatch-Signature"
  },
  EMAIL: {
    EMAIL_PROVIDER_HEALTHCHECK_URL: "",
    EMAIL_FROM: "alerts@example.com",
    EMAIL_REPLY_TO: ""
  },
  STRIPE: {
    STRIPE_API_KEY: "",
    STRIPE_API_BASE: "https://api.stripe.com",
    STRIPE_WEBHOOK_SECRET: ""
  },
  WORKER_PROVIDER: {
    WORKER_RESTART_WEBHOOK_URL: "",
    WORKER_PROVIDER_TIMEOUT_MS: 5000
  },
  SERVICE_PROVIDER: {
    SERVICE_RESTART_WEBHOOK_URL: "",
    SERVICE_PROVIDER_TIMEOUT_MS: 5000
  },
  DEPLOYMENT_PROVIDER: {
    DEPLOYMENT_ROLLBACK_WEBHOOK_URL: "",
    DEPLOYMENT_PROVIDER_TIMEOUT_MS: 5000
  },
  STATUS_PROVIDER: {
    PROVIDER_STATUS_URL: "",
    STATUS_PAGE_COMPONENT: "",
    STATUS_PAGE_ENV: ""
  },
  RUNBOOK_PROVIDER: {
    RUNBOOK_BASE_URL: "",
    RUNBOOK_DEFAULT_OWNER: "platform",
    RUNBOOK_TEMPLATE: "incident-standard"
  }
};

const providerTitle = (provider: string) =>
  provider
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const statusClass = (status?: IntegrationValidationStatus) => {
  if (status === "VALID") return "pass";
  if (status === "INVALID") return "fail";
  return "unknown";
};

export default function ProviderIntegrationDetailPage() {
  const params = useParams<{ projectId: string; provider: string }>();
  const providerType = useMemo(() => (params.provider || "webhook").toUpperCase(), [params.provider]);
  const preset = useMemo(() => PROVIDER_PRESETS[providerType] ?? {}, [providerType]);

  const [integration, setIntegration] = useState<ProjectIntegration | null>(null);
  const [draft, setDraft] = useState<IntegrationDraft>({
    enabled: true,
    name: "",
    secretRef: "",
    configJson: preset
  });
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

        setIntegration(match || null);
        setDraft({
          enabled: match?.enabled ?? true,
          name: match?.name ?? `${providerTitle(providerType)} integration`,
          secretRef: match?.secretRef ?? "",
          configJson: {
            ...preset,
            ...(match?.configJson ?? {})
          }
        });
      } catch (loadError: any) {
        setError(loadError?.message || "Failed to load integration");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [params.projectId, providerType, preset]);

  const setConfigValue = (key: string, value: unknown) => {
    setDraft((current) => ({
      ...current,
      configJson: {
        ...current.configJson,
        [key]: value
      }
    }));
  };

  const persistIntegration = async () => {
    const saved = await apiFetch<ProjectIntegration>(`/settings/integrations/${params.projectId}/${providerType}`, {
      method: "PUT",
      body: JSON.stringify({
        enabled: draft.enabled,
        name: draft.name || undefined,
        secretRef: draft.secretRef || undefined,
        configJson: draft.configJson
      })
    });

    setIntegration(saved);
    return saved;
  };

  const saveIntegration = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await persistIntegration();
      setMessage("Integration saved.");
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to save integration");
    } finally {
      setSaving(false);
    }
  };

  const validateIntegration = async () => {
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
      setDraft((current) => ({
        ...current,
        enabled: validated.enabled,
        name: validated.name ?? current.name,
        secretRef: validated.secretRef ?? current.secretRef,
        configJson: {
          ...preset,
          ...(validated.configJson ?? current.configJson)
        }
      }));
      setMessage(validated.validationStatus === "VALID" ? "Integration validated." : "Validation failed. Review the message below.");
    } catch (validateError: any) {
      setError(validateError?.message || "Failed to validate integration");
    } finally {
      setValidating(false);
    }
  };

  const renderProviderFields = () => {
    if (providerType === "WEBHOOK") {
      return (
        <>
          <label>
            Webhook URL
            <input
              value={String(draft.configJson.WEBHOOK_URL ?? "")}
              onChange={(event) => setConfigValue("WEBHOOK_URL", event.target.value)}
              placeholder="https://client.example.com/opswatch/webhook"
              required
            />
          </label>
          <div className="form-row">
            <label>
              Timeout ms
              <input
                type="number"
                min={1000}
                step={500}
                value={Number(draft.configJson.WEBHOOK_TIMEOUT_MS ?? 5000)}
                onChange={(event) => setConfigValue("WEBHOOK_TIMEOUT_MS", Number(event.target.value))}
              />
            </label>
            <label>
              Signing header
              <input
                value={String(draft.configJson.WEBHOOK_SIGNING_HEADER ?? "X-OpsWatch-Signature")}
                onChange={(event) => setConfigValue("WEBHOOK_SIGNING_HEADER", event.target.value)}
              />
            </label>
          </div>
        </>
      );
    }

    return (
      <label>
        Config JSON
        <textarea
          rows={10}
          value={JSON.stringify(draft.configJson, null, 2)}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.target.value);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                setDraft((current) => ({ ...current, configJson: parsed as Record<string, unknown> }));
              }
            } catch {
              setError("Config JSON is not valid yet.");
            }
          }}
        />
      </label>
    );
  };

  return (
    <Shell>
      <Header title={`Integration: ${providerTitle(providerType)}`} />

      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel success-panel">{message}</section> : null}

      <section className="two-col settings-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>{providerTitle(providerType)} setup</h2>
              <p>{loading ? "Loading integration..." : "Save provider details, then validate connectivity."}</p>
            </div>
            <span className={`result-pill ${statusClass(integration?.validationStatus)}`}>
              {integration?.validationStatus ?? "UNKNOWN"}
            </span>
          </div>

          <form className="stack-form" onSubmit={saveIntegration}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Enabled
            </label>

            <label>
              Display name
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={`${providerType.toLowerCase()} integration`}
              />
            </label>

            <label>
              Secret reference
              <input
                value={draft.secretRef}
                onChange={(event) => setDraft((current) => ({ ...current, secretRef: event.target.value }))}
                placeholder="vault://opswatch/sparkle/webhook"
              />
            </label>

            {renderProviderFields()}

            <div className="channel-actions">
              <button type="submit" className="secondary-button" disabled={saving || validating}>
                {saving ? "Saving..." : "Save integration"}
              </button>
              <button type="button" className="primary-button" onClick={() => void validateIntegration()} disabled={saving || validating}>
                {validating ? "Validating..." : "Save and validate"}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel">
          <h2>Client fix guide</h2>
          {providerType === "WEBHOOK" ? (
            <>
              <p>Ask the client for a public HTTPS webhook URL that accepts OpsWatch events.</p>
              <ol className="client-fix-list">
                <li>Paste the endpoint into Webhook URL.</li>
                <li>Store any shared secret in your vault and put the reference in Secret reference.</li>
                <li>Click Save and validate. OpsWatch will call the URL and show the result here.</li>
              </ol>
            </>
          ) : (
            <p>Fill in the provider config and validate it before relying on the integration for alerts or automation.</p>
          )}

          <dl className="detail-list">
            <div>
              <dt>Last validated</dt>
              <dd>{integration?.lastValidatedAt ? new Date(integration.lastValidatedAt).toLocaleString() : "-"}</dd>
            </div>
            <div>
              <dt>Validation message</dt>
              <dd>{integration?.validationMessage || "-"}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{params.projectId}</dd>
            </div>
          </dl>

          <Link className="secondary-button" href={`/projects/${params.projectId}`}>
            Back to project
          </Link>
        </aside>
      </section>
    </Shell>
  );
}
