"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { API_BASE_URL } from "../../lib/constants";

type WizardStep = "register" | "credentials" | "verification" | "finish";

type IngestCredentials = {
  apiKey?: string;
  signingSecret?: string;
  projectSlug?: string;
  scopes?: string[];
  reused?: boolean;
  error?: string;
};

type CreateApplicationResponse = {
  id: string;
  name: string;
  slug: string;
  environment?: string;
  ingestCredentials?: IngestCredentials;
};

type OrgSummary = {
  id: string;
  name: string;
  slug: string;
};

type HeartbeatRow = {
  receivedAt: string;
  environment?: string;
  appVersion?: string | null;
  status?: string;
};

type ProjectConnection = {
  id: string;
  name: string;
  slug: string;
  environment?: string;
  heartbeats?: HeartbeatRow[];
};

type RegisterForm = {
  name: string;
  clientName: string;
  environment: string;
  publicUrl: string;
};

const SDK_PACKAGE = "@opswatch/client";

const STEP_LABELS: Record<WizardStep, string> = {
  register: "Register",
  credentials: "API connection",
  verification: "Verify connection",
  finish: "Finish"
};

const EMPTY_FORM: RegisterForm = {
  name: "",
  clientName: "",
  environment: "production",
  publicUrl: ""
};

const buildSetupEnv = (input: {
  apiKey: string;
  signingSecret: string;
  projectSlug: string;
  publicUrl?: string;
}): string => {
  const lines = [
    `OPSWATCH_API_URL=${API_BASE_URL}`,
    `OPSWATCH_API_KEY=${input.apiKey}`,
    `OPSWATCH_SIGNING_SECRET=${input.signingSecret}`,
    `OPSWATCH_PROJECT_SLUG=${input.projectSlug}`
  ];
  if (input.publicUrl?.trim()) {
    lines.push(`APP_PUBLIC_URL=${input.publicUrl.trim()}`);
  }
  return `${lines.join("\n")}\n`;
};

type RegisterApplicationWizardProps = {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  knownClients?: string[];
};

export function RegisterApplicationWizard({
  onClose,
  onCreated,
  knownClients = []
}: RegisterApplicationWizardProps) {
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [step, setStep] = useState<WizardStep>("register");
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateApplicationResponse | null>(null);
  const [connection, setConnection] = useState<ProjectConnection | null>(null);
  const [waitingForHeartbeat, setWaitingForHeartbeat] = useState(false);

  const credentials = created?.ingestCredentials;
  const hasCredentials = Boolean(credentials && !credentials.error && credentials.apiKey);
  const latestHeartbeat = connection?.heartbeats?.[0] ?? null;
  const isConnected = Boolean(latestHeartbeat);

  const clientSuggestions = useMemo(
    () => [...new Set(knownClients.map((value) => value.trim()).filter(Boolean))].sort(),
    [knownClients]
  );

  const setupEnv = useMemo(() => {
    if (!hasCredentials || !credentials?.apiKey || !credentials.signingSecret || !credentials.projectSlug) {
      return "";
    }
    return buildSetupEnv({
      apiKey: credentials.apiKey,
      signingSecret: credentials.signingSecret,
      projectSlug: credentials.projectSlug,
      publicUrl: form.publicUrl
    });
  }, [credentials, form.publicUrl, hasCredentials]);

  useEffect(() => {
    void apiFetch<OrgSummary>("/org")
      .then(setOrg)
      .catch(() => setOrg(null));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaitingForHeartbeat(false);
  }, []);

  const pollConnection = useCallback(
    async (projectId: string) => {
      try {
        const project = await apiFetch<ProjectConnection>(`/projects/${projectId}`);
        setConnection(project);
        if (project.heartbeats?.length) {
          stopPolling();
          setStep("finish");
        }
      } catch {
        // Keep polling until heartbeat arrives or user skips.
      }
    },
    [stopPolling]
  );

  useEffect(() => {
    if (step !== "verification" || !created?.id) {
      stopPolling();
      return;
    }

    setWaitingForHeartbeat(true);
    void pollConnection(created.id);
    pollRef.current = setInterval(() => {
      void pollConnection(created.id);
    }, 3000);

    return () => stopPolling();
  }, [created?.id, pollConnection, step, stopPolling]);

  const updateName = (value: string) => {
    setForm((current) => ({ ...current, name: value }));
  };

  const registerApplication = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch<CreateApplicationResponse>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          clientName: form.clientName.trim() || form.name.trim(),
          environment: form.environment,
          frontendUrl: form.publicUrl.trim() || undefined,
          monitoringEnabled: true,
          automationMode: "OBSERVE"
        })
      });

      setCreated(response);

      if (response.ingestCredentials?.error) {
        setError(response.ingestCredentials.error);
        setStep("credentials");
        await onCreated();
        return;
      }

      if (!response.ingestCredentials?.apiKey && !response.ingestCredentials?.reused) {
        setError("Application created but ingest credentials were not returned. Check API logs and retry from project settings.");
      }

      setStep("credentials");
      await onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register application");
    } finally {
      setSaving(false);
    }
  };

  const copyCredentials = async () => {
    if (!setupEnv) return;
    await navigator.clipboard.writeText(setupEnv);
  };

  const downloadSetup = () => {
    if (!setupEnv || !created?.slug) return;
    const blob = new Blob([setupEnv], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${created.slug}-opswatch.env`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const closeWizard = () => {
    stopPolling();
    onClose();
  };

  const stepOrder: WizardStep[] = ["register", "credentials", "verification", "finish"];
  const stepIndex = stepOrder.indexOf(step);

  return (
    <section className="panel register-wizard">
      <div className="section-head">
        <div>
          <h2>
            {step === "register"
              ? "Register application"
              : step === "credentials"
                ? "Application created"
                : step === "verification"
                  ? "Connection verification"
                  : "Application connected"}
          </h2>
          <p>
            {step === "register"
              ? "Connect a new application to OpsWatch. Only the essentials are required — everything else is configured after the first heartbeat."
              : step === "credentials"
                ? "Copy these credentials into your application. They are shown only once."
                : step === "verification"
                  ? "Install the SDK and send a heartbeat. OpsWatch will detect your application automatically."
                  : "Secure connection established. Topology, health collection, and automation can be configured in project settings."}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={closeWizard} data-action="local-ui">
          Cancel
        </button>
      </div>

      <div className="register-wizard-steps" aria-label="Registration progress">
        {stepOrder.map((key, index) => (
          <div
            key={key}
            className={`register-wizard-step${index <= stepIndex ? " register-wizard-step--active" : ""}${index < stepIndex ? " register-wizard-step--done" : ""}`}
          >
            <span className="register-wizard-step-number">{index < stepIndex ? "✓" : index + 1}</span>
            <span>{STEP_LABELS[key]}</span>
          </div>
        ))}
      </div>

      {error ? <div className="error-panel" style={{ marginBottom: "1rem" }}>{error}</div> : null}

      {step === "register" ? (
        <form className="stack-form" onSubmit={(event) => void registerApplication(event)}>
          <label>
            Application name *
            <input
              value={form.name}
              onChange={(event) => updateName(event.target.value)}
              placeholder="Sparkle"
              required
              autoFocus
            />
          </label>

          <label>
            Organization *
            <input value={org?.name ?? "Loading organization…"} disabled />
            <span className="field-hint">Applications belong to your OpsWatch organization. Client companies are optional below.</span>
          </label>

          <label>
            Client (optional)
            <input
              value={form.clientName}
              onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))}
              placeholder="Noble Express Courier Services Ltd"
              list="known-clients"
            />
            <datalist id="known-clients">
              {clientSuggestions.map((client) => (
                <option key={client} value={client} />
              ))}
            </datalist>
          </label>

          <div className="form-row">
            <label>
              Environment *
              <select
                value={form.environment}
                onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </label>
            <label>
              Public application URL (optional)
              <input
                value={form.publicUrl}
                onChange={(event) => setForm((current) => ({ ...current, publicUrl: event.target.value }))}
                placeholder="https://example.com"
                type="url"
              />
            </label>
          </div>

          <button className="primary-button" type="submit" disabled={saving || !org} data-action="api" data-endpoint="/projects">
            {saving ? "Creating…" : "Create application & generate API key"}
          </button>
        </form>
      ) : null}

      {step === "credentials" && created ? (
        <div className="stack-form">
          <label>
            Application ID
            <input value={created.id} readOnly />
          </label>

          {hasCredentials && credentials?.apiKey ? (
            <label>
              API key
              <input value={credentials.apiKey} readOnly />
            </label>
          ) : (
            <p className="warn-text">No new API key was issued. Use an existing org key or create one under Organization settings.</p>
          )}

          {credentials?.signingSecret ? (
            <label>
              Signing secret
              <input value={credentials.signingSecret} readOnly />
            </label>
          ) : null}

          <label>
            SDK
            <input value={SDK_PACKAGE} readOnly />
          </label>

          <fieldset className="scope-grid">
            <legend>Authentication method</legend>
            <label className="checkbox-label">
              <input type="radio" name="auth-method" checked readOnly />
              API key
            </label>
            <label className="checkbox-label" style={{ opacity: 0.55 }}>
              <input type="radio" name="auth-method" disabled />
              mTLS (Enterprise)
            </label>
          </fieldset>

          {setupEnv ? (
            <label>
              Setup snippet
              <textarea readOnly rows={6} value={setupEnv} />
            </label>
          ) : null}

          <div className="register-wizard-actions">
            {setupEnv ? (
              <>
                <button type="button" className="secondary-button" onClick={() => void copyCredentials()} data-action="local-ui">
                  Copy credentials
                </button>
                <button type="button" className="secondary-button" onClick={downloadSetup} data-action="local-ui">
                  Download setup
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="primary-button"
              onClick={() => setStep("verification")}
              data-action="local-ui"
            >
              Continue to verification
            </button>
          </div>

          <p className="warn-text">Store credentials securely. The API key is shown only once.</p>
        </div>
      ) : null}

      {step === "verification" && created ? (
        <div className="stack-form">
          <label>
            Connection status
            <input
              value={
                isConnected
                  ? "Connected — first heartbeat received"
                  : waitingForHeartbeat
                    ? "Waiting for application…"
                    : "Not connected yet"
              }
              readOnly
            />
          </label>

          <ul className="register-wizard-checklist">
            <li className={isConnected ? "done" : ""}>Connected</li>
            <li className={latestHeartbeat?.receivedAt ? "done" : ""}>
              Last heartbeat {latestHeartbeat?.receivedAt ? new Date(latestHeartbeat.receivedAt).toLocaleString() : "—"}
            </li>
            <li className={latestHeartbeat?.appVersion ? "done" : ""}>
              Application version {latestHeartbeat?.appVersion ?? "—"}
            </li>
            <li className={latestHeartbeat?.environment ? "done" : ""}>
              Environment {latestHeartbeat?.environment ?? created.environment ?? "—"}
            </li>
          </ul>

          <div className="hint-panel">
            <strong>Next in your app</strong>
            <ol>
              <li>
                Install <code>{SDK_PACKAGE}</code> and configure the env snippet from the previous step.
              </li>
              <li>Send a heartbeat from your application startup or cron.</li>
              <li>OpsWatch will discover modules, services, and dependencies after connection.</li>
            </ol>
          </div>

          <div className="register-wizard-actions">
            <button type="button" className="secondary-button" onClick={() => setStep("credentials")} data-action="local-ui">
              Back
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                stopPolling();
                setStep("finish");
              }}
              data-action="local-ui"
            >
              {isConnected ? "Continue" : "Skip for now"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "finish" && created ? (
        <div className="stack-form">
          <ul className="register-wizard-checklist">
            <li className="done">Application registered</li>
            <li className={hasCredentials ? "done" : ""}>API key generated</li>
            <li className={isConnected ? "done" : ""}>Heartbeat {isConnected ? "received" : "pending"}</li>
            <li>Modules, workflows, and dependencies — discovered after ingest</li>
            <li>Health collection, incident policy, automation, notifications, AI — configure in settings</li>
          </ul>

          <div className="register-wizard-actions">
            <button type="button" className="secondary-button" onClick={closeWizard} data-action="local-ui">
              Close
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => router.push(`/projects/${created.id}`)}
              data-action="local-ui"
            >
              Open application settings
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => router.push("/dashboard")}
              data-action="local-ui"
            >
              Open command center
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
