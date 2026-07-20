"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { PageSection } from "../../../../components/ui/page-section";
import { apiFetch } from "../../../../lib/api";

type StripeSettings = {
  configured: boolean;
  publishableKey: string | null;
  secretKeyMasked: string | null;
  webhookSecretMasked: string | null;
  stripeAccountId: string | null;
  apiBase: string;
  mode: "test" | "live" | null;
  validationStatus: "UNKNOWN" | "VALID" | "INVALID";
  validationMessage: string | null;
  validationDetails: {
    checks?: Array<{ id: string; label: string; status: string }>;
    account?: { name?: string; mode?: "test" | "live"; apiVersion?: string; id?: string };
    webhook?: { configured: boolean; verified: boolean };
  } | null;
  lastValidatedAt: string | null;
  credentialSource: "database" | "environment" | "none";
};

type LegacyIntegration = {
  integrationId: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  note: string;
};

type LifecycleState =
  | "not_configured"
  | "configuration_saved"
  | "validation_required"
  | "testing"
  | "connected"
  | "validation_failed";

const lifecycleMeta: Record<
  LifecycleState,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; icon: string }
> = {
  not_configured: { label: "Not configured", tone: "neutral", icon: "⚪" },
  configuration_saved: { label: "Configuration saved", tone: "info", icon: "🟡" },
  validation_required: { label: "Validation required", tone: "warning", icon: "🟡" },
  testing: { label: "Testing…", tone: "info", icon: "🟡" },
  connected: { label: "Connected", tone: "success", icon: "🟢" },
  validation_failed: { label: "Validation failed", tone: "danger", icon: "🔴" }
};

const configurationSourceLabel = (source?: StripeSettings["credentialSource"]): string => {
  if (source === "database") return "Database";
  if (source === "environment") return "Environment fallback";
  return "None";
};

const maskStripeAccountId = (accountId?: string | null): string => {
  if (!accountId?.trim()) return "—";
  const trimmed = accountId.trim();
  if (trimmed.length <= 8) return trimmed;
  const suffix = trimmed.slice(-4);
  if (trimmed.startsWith("acct_")) return `acct_${"•".repeat(6)}${suffix}`;
  return `${trimmed.slice(0, 4)}${"•".repeat(6)}${suffix}`;
};

const formatValidationTimestamp = (value?: string | null): string => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";

  if (days < 7) return `${days} days ago`;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
};

const resolveLifecycleState = (settings: StripeSettings | null, validating: boolean): LifecycleState => {
  if (validating) return "testing";
  if (!settings?.configured) return "not_configured";
  if (settings.validationStatus === "VALID") return "connected";
  if (settings.validationStatus === "INVALID") return "validation_failed";
  if (!settings.lastValidatedAt) {
    return settings.validationMessage?.toLowerCase().includes("saved")
      ? "validation_required"
      : "configuration_saved";
  }
  return "configuration_saved";
};

const runtimeStatusCopy = (settings: StripeSettings | null): { title: string; body: string; tone: "info" | "warning" | "neutral" | "test" } => {
  if (!settings?.configured) {
    return {
      title: "Runtime configuration: Not available",
      body: "Add platform Stripe credentials or configure deployment environment variables before checkout and billing portal can run.",
      tone: "test"
    };
  }

  if (settings.credentialSource === "environment") {
    return {
      title: "Runtime configuration: Environment fallback",
      body: "Platform payments are currently using deployment environment credentials. Save here to store encrypted platform settings in the database.",
      tone: "info"
    };
  }

  if (settings.credentialSource === "database" && settings.validationStatus === "UNKNOWN" && !settings.lastValidatedAt) {
    return {
      title: "Database configuration stored",
      body: "Credentials are saved in encrypted platform storage. Validate the connection to confirm API, webhook, checkout, and billing portal readiness.",
      tone: "info"
    };
  }

  if (settings.validationStatus === "INVALID") {
    return {
      title: "Validation failed",
      body: settings.validationMessage ?? "Stripe rejected the saved credentials. Update the configuration and validate again.",
      tone: "test"
    };
  }

  return {
    title: "Runtime configuration: Database",
    body: "Platform payments are using encrypted credentials stored for this deployment.",
    tone: "neutral"
  };
};

const checkGlyph = (status: "pass" | "fail" | "warn" | "pending" | "unknown") => {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  if (status === "fail") return "✗";
  return "—";
};

const buildReadinessChecks = (settings: StripeSettings | null) => {
  if (settings?.validationDetails?.checks?.length) {
    return settings.validationDetails.checks.map((check) => ({
      id: check.id,
      label: check.label,
      status:
        check.status === "pass" || check.status === "fail" || check.status === "warn" || check.status === "pending"
          ? check.status
          : ("unknown" as const)
    }));
  }

  const webhookConfigured = Boolean(settings?.webhookSecretMasked);
  return [
    { id: "api", label: "API reachable", status: "unknown" as const },
    { id: "credentials", label: "Credentials accepted", status: "unknown" as const },
    {
      id: "webhook",
      label: "Webhook configured",
      status: webhookConfigured ? ("warn" as const) : ("unknown" as const)
    },
    { id: "checkout", label: "Checkout ready", status: "unknown" as const },
    { id: "portal", label: "Billing portal ready", status: "unknown" as const }
  ];
};

export default function PlatformStripeAdminPage() {
  const validateButtonRef = useRef<HTMLButtonElement>(null);
  const [settings, setSettings] = useState<StripeSettings | null>(null);
  const [legacy, setLegacy] = useState<LegacyIntegration[]>([]);
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [apiBase, setApiBase] = useState("https://api.stripe.com");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const lifecycle = useMemo(() => resolveLifecycleState(settings, validating), [settings, validating]);
  const lifecycleDisplay = lifecycleMeta[lifecycle];
  const runtimeStatus = useMemo(() => runtimeStatusCopy(settings), [settings]);
  const readinessChecks = useMemo(() => buildReadinessChecks(settings), [settings]);
  const needsValidation = lifecycle === "configuration_saved" || lifecycle === "validation_required";

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, legacyData] = await Promise.all([
        apiFetch<StripeSettings>("/admin/billing/stripe", { suppressAuthRedirect: true }),
        apiFetch<{ integrations: LegacyIntegration[] }>("/admin/billing/stripe/legacy-integrations", {
          suppressAuthRedirect: true
        })
      ]);
      setSettings(data);
      setLegacy(legacyData.integrations ?? []);
      setPublishableKey(data.publishableKey ?? "");
      setApiBase(data.apiBase || "https://api.stripe.com");
      setSecretKey("");
      setWebhookSecret("");
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load platform Stripe settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveConfiguration = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiFetch<StripeSettings>("/admin/billing/stripe", {
        method: "PUT",
        suppressAuthRedirect: true,
        body: JSON.stringify({
          publishableKey: publishableKey || null,
          secretKey: secretKey || null,
          webhookSecret: webhookSecret || null,
          apiBase
        })
      });
      setSettings(saved);
      setSecretKey("");
      setWebhookSecret("");
      setMessage("Configuration saved. Press Validate connection to confirm platform billing readiness.");
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to save Stripe configuration");
    } finally {
      setSaving(false);
    }
  };

  const validateConnection = async () => {
    setValidating(true);
    setError(null);
    setMessage(null);
    try {
      await saveConfiguration();
      const validated = await apiFetch<StripeSettings>("/admin/billing/stripe/validate", {
        method: "POST",
        suppressAuthRedirect: true
      });
      setSettings(validated);
      setMessage(validated.validationMessage || "Validation complete.");
    } catch (validateError: any) {
      setError(validateError?.message || "Stripe validation failed");
    } finally {
      setValidating(false);
    }
  };

  const scrollToValidate = () => {
    validateButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    validateButtonRef.current?.focus();
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "Remove stored platform Stripe credentials from the database? Deployment environment credentials may still be used at runtime."
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const disconnected = await apiFetch<StripeSettings>("/admin/billing/stripe/disconnect", {
        method: "POST",
        suppressAuthRedirect: true
      });
      setSettings(disconnected);
      setPublishableKey(disconnected.publishableKey ?? "");
      setSecretKey("");
      setWebhookSecret("");
      if (disconnected.credentialSource === "environment") {
        setMessage("Stored platform credentials removed. Runtime is still available via environment fallback.");
      } else {
        setMessage("Stored platform credentials removed.");
      }
    } catch (disconnectError: any) {
      setError(disconnectError?.message || "Failed to disconnect Stripe");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Header title="Stripe Billing Infrastructure" />

      <PageSection
        title="How billing works"
        persistKey="org:admin:stripe:overview"
      >
        <p>
          OpsWatch uses a single Stripe account to process subscription payments. Each customer organization is
          represented as a Stripe Customer within that account and maintains its own subscription, invoices, and billing
          history. This page configures the platform connection only.
        </p>
      </PageSection>

      <section className="two-col settings-grid provider-layout">
        <PageSection
          title="Platform payment connection"
          description={
            loading
              ? "Loading..."
              : "Configure the single Stripe account OpsWatch uses to collect subscription payments from all organizations."
          }
          persistKey="org:admin:stripe:connection"
          actions={
            needsValidation ? (
              <button
                type="button"
                className={`connection-status connection-status--${lifecycleDisplay.tone} connection-status--clickable`}
                onClick={scrollToValidate}
                title="Scroll to Validate connection"
              >
                <span aria-hidden="true">{lifecycleDisplay.icon}</span>
                <span>{lifecycleDisplay.label}</span>
              </button>
            ) : (
              <span className={`connection-status connection-status--${lifecycleDisplay.tone}`}>
                <span aria-hidden="true">{lifecycleDisplay.icon}</span>
                <span>{lifecycleDisplay.label}</span>
              </span>
            )
          }
        >
          {error ? <section className="panel error-panel platform-workflow-banner">{error}</section> : null}
          {message ? <section className="panel success-panel platform-workflow-banner">{message}</section> : null}

          {needsValidation ? (
            <section className="panel validation-callout">
              <strong>Validation required.</strong> Save any pending changes, then press{" "}
              <strong>Validate connection</strong> to verify API access, webhook readiness, checkout, and billing portal
              support.
            </section>
          ) : null}

          <form className="stack-form" onSubmit={saveConfiguration}>
            <section className="provider-section">
              <div className="provider-section__head">
                <h3>Credentials</h3>
                <p>Secrets are encrypted at rest and never returned unmasked.</p>
              </div>
              <label>
                Publishable key
                <input value={publishableKey} onChange={(e) => setPublishableKey(e.target.value)} placeholder="pk_test_..." />
              </label>
              <label>
                Secret key
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={settings?.secretKeyMasked ?? "sk_test_..."}
                  autoComplete="off"
                />
              </label>
              <label>
                Webhook signing secret
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={settings?.webhookSecretMasked ?? "whsec_..."}
                  autoComplete="off"
                />
              </label>
            </section>

            <section className="provider-section">
              <div className="provider-section__head">
                <h3>Provider configuration</h3>
              </div>
              <label>
                API base
                <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.stripe.com" />
              </label>
            </section>

            <div className="channel-actions platform-stripe-actions">
              <button
                ref={validateButtonRef}
                type="button"
                className="primary-button"
                onClick={() => void validateConnection()}
                disabled={saving || validating}
              >
                {validating ? "Validating…" : "Validate connection"}
              </button>
              <button type="submit" className="secondary-button" disabled={saving || validating}>
                {saving ? "Saving…" : "Save configuration"}
              </button>
              <button
                type="button"
                className="solid-danger-button"
                onClick={() => void disconnect()}
                disabled={saving || validating}
              >
                Disconnect stored credentials
              </button>
            </div>
          </form>
        </PageSection>

        <aside className="provider-layout__aside">
          <PageSection
            title="Connection health"
            className="provider-dashboard"
            persistKey="org:admin:stripe:health"
          >
            <div className={`mode-banner mode-banner--${runtimeStatus.tone}`}>
              <strong>{runtimeStatus.title}</strong>
              <p>{runtimeStatus.body}</p>
            </div>

            <div className="validation-health-card">
              <h3>Readiness</h3>
              <ul className="validation-health-list">
                {readinessChecks.map((check) => {
                  const status =
                    check.status === "pass" ||
                    check.status === "fail" ||
                    check.status === "warn" ||
                    check.status === "pending"
                      ? check.status
                      : "unknown";
                  return (
                    <li key={check.id} className={`validation-health-item validation-health-item--${status}`}>
                      <span aria-hidden="true">{checkGlyph(status)}</span>
                      <span>{check.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <dl className="provider-dashboard__stats">
              <div>
                <dt>Stripe account</dt>
                <dd>
                  {maskStripeAccountId(settings?.stripeAccountId ?? settings?.validationDetails?.account?.id)}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{settings?.mode === "live" ? "Live" : settings?.mode === "test" ? "Test" : "—"}</dd>
              </div>
              <div>
                <dt>Last validation</dt>
                <dd title={settings?.lastValidatedAt ?? undefined}>{formatValidationTimestamp(settings?.lastValidatedAt)}</dd>
              </div>
              <div>
                <dt>Configuration source</dt>
                <dd>{configurationSourceLabel(settings?.credentialSource)}</dd>
              </div>
              {settings?.validationDetails?.account?.name ? (
                <div>
                  <dt>Account name</dt>
                  <dd>{settings.validationDetails.account.name}</dd>
                </div>
              ) : null}
            </dl>

            {settings?.mode === "test" ? (
              <div className="mode-banner mode-banner--test">These credentials cannot process live payments.</div>
            ) : null}
            {settings?.mode === "live" ? (
              <div className="mode-banner mode-banner--live">Production payments enabled.</div>
            ) : null}
          </PageSection>

          {legacy.length > 0 ? (
            <PageSection
              title="Legacy project Stripe records"
              description="These project integrations still contain Stripe credentials. Review manually — do not auto-migrate."
              persistKey="org:admin:stripe:legacy"
              defaultCollapsed
            >
              <ul className="validation-health-list">
                {legacy.map((row) => (
                  <li key={row.integrationId}>
                    <Link href={`/integrations/${row.projectId}`}>{row.projectName}</Link>
                    {" — "}
                    {row.hasSecretKey ? "has API key" : "no API key"}
                    {row.hasWebhookSecret ? ", has webhook secret" : ""}
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}
        </aside>
      </section>
    </Shell>
  );
}
