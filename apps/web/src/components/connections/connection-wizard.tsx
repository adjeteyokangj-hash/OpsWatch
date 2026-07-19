"use client";

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import {
  applyApplicationSelection,
  applyEnvironmentChange,
  authRequiresSecret,
  authShowsHeaderName,
  authShowsPrefix,
  buildGuidedConnectionPayload,
  clearAuthSecret,
  connectionTestMessage,
  connectionTestPassed,
  discoveredServiceNames,
  formatLatency,
  isRestMethod
} from "./connection-form-state";
import { ConnectionWizardSummary } from "./connection-wizard-summary";
import {
  AUTH_TYPES,
  CONNECTION_ENVIRONMENTS,
  CONNECTION_METHODS,
  TIMEOUT_OPTIONS_SECONDS,
  emptyGuidedForm,
  type ConnectionTestResult,
  type GuidedConnectionForm,
  type ProjectOption,
  type TimeoutSeconds
} from "./types";

export type ConnectionWizardProps = {
  projects: ProjectOption[];
  initialApplicationId?: string;
  initialForm?: GuidedConnectionForm;
  editingConnectionId?: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
};

export function ConnectionWizard({
  projects,
  initialApplicationId = "",
  initialForm,
  editingConnectionId = null,
  onCancel,
  onSaved
}: ConnectionWizardProps) {
  const baseId = useId();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<GuidedConnectionForm>(() => {
    if (initialForm) return initialForm;
    if (initialApplicationId) {
      return applyApplicationSelection(emptyGuidedForm(), initialApplicationId, projects);
    }
    return emptyGuidedForm();
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<"idle" | "testing" | "saving" | "monitoring">("idle");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testSucceeded, setTestSucceeded] = useState(false);
  const [hydratedApplicationId, setHydratedApplicationId] = useState(
    () => (initialForm ? initialForm.applicationId : "")
  );

  useEffect(() => {
    if (initialForm) return;
    if (!initialApplicationId || projects.length === 0) return;
    if (hydratedApplicationId === initialApplicationId) return;
    setForm(applyApplicationSelection(emptyGuidedForm(), initialApplicationId, projects));
    setHydratedApplicationId(initialApplicationId);
    setTestSucceeded(false);
    setTestResult(null);
  }, [initialApplicationId, initialForm, projects, hydratedApplicationId]);

  const updateForm = (patch: Partial<GuidedConnectionForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setTestSucceeded(false);
    setTestResult(null);
  };

  const detailsValid = Boolean(form.applicationId && form.name.trim());
  const configurationValid =
    !isRestMethod(form.method) ||
    (Boolean(form.baseUrl.trim()) && Boolean(form.healthPath.trim()) && (!authRequiresSecret(form.authType) || Boolean(form.authSecret.trim()) || Boolean(editingConnectionId)));

  const goNext = () => {
    setError(null);
    if (step === 1 && !detailsValid) {
      setError("Choose an application and enter a connection name.");
      return;
    }
    if (step === 2 && !configurationValid) {
      setError("Complete the required configuration fields before continuing.");
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  };

  const runUnsavedTest = async () => {
    setBusy("testing");
    setError(null);
    setTestResult(null);
    setTestSucceeded(false);
    try {
      const payload = buildGuidedConnectionPayload(form, { startMonitoring: false, includeSecret: true });
      const result = await apiFetch<ConnectionTestResult>("/connections/test", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setTestResult(result);
      if (connectionTestPassed(result)) {
        setTestSucceeded(true);
      } else {
        setTestSucceeded(false);
        setError(connectionTestMessage(result));
      }
    } catch (testError) {
      setTestSucceeded(false);
      setError(testError instanceof Error ? testError.message : "Connection test failed");
    } finally {
      setBusy("idle");
    }
  };

  const saveDraft = async () => {
    setBusy("saving");
    setError(null);
    try {
      const payload = buildGuidedConnectionPayload(form, { startMonitoring: false, includeSecret: true });
      if (editingConnectionId) {
        await apiFetch(`/connections/${editingConnectionId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch("/connections", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      setForm((current) => clearAuthSecret(current));
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save connection");
    } finally {
      setBusy("idle");
    }
  };

  const saveAndStartMonitoring = async () => {
    if (!testSucceeded) {
      setError("Run a successful connection test before starting monitoring.");
      return;
    }
    setBusy("monitoring");
    setError(null);
    try {
      const payload = buildGuidedConnectionPayload(form, { startMonitoring: false, includeSecret: true });
      const created = editingConnectionId
        ? await apiFetch<{ id: string }>(`/connections/${editingConnectionId}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          }).then(() => ({ id: editingConnectionId }))
        : await apiFetch<{ id: string }>("/connections", {
            method: "POST",
            body: JSON.stringify(payload)
          });

      setForm((current) => clearAuthSecret(current));

      const result = await apiFetch<ConnectionTestResult>(`/connections/${created.id}/test`, {
        method: "POST",
        body: JSON.stringify({ startMonitoring: true })
      });

      if (!connectionTestPassed(result)) {
        setTestResult(result);
        setTestSucceeded(false);
        setError(
          connectionTestMessage(result) ||
            "Saved as draft, but monitoring could not start until a real test succeeds."
        );
        await onSaved();
        return;
      }

      setTestResult(result);
      setTestSucceeded(true);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save and start monitoring");
    } finally {
      setBusy("idle");
    }
  };

  const onPasteSecret = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) updateForm({ authSecret: text.trim() });
    } catch {
      setError("Clipboard paste was blocked by the browser. Paste manually instead.");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  const discovered = discoveredServiceNames(testResult?.discoveredServices);

  return (
    <section className="panel connection-wizard" aria-label="Add connection">
      <div className="connection-wizard__header">
        <div>
          <h2>{editingConnectionId ? "Edit connection" : "Add connection"}</h2>
          <p className="dashboard-subtle">
            Guided setup for application connections. Credentials stay write-only and are cleared from this form after save.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error ? (
        <div className="panel error-panel" role="alert">
          {error}
        </div>
      ) : null}

      <div className="connection-wizard__layout">
        <form className="connection-wizard__form" onSubmit={handleSubmit}>
          {step === 1 ? (
            <fieldset className="connection-wizard__step" data-testid="connection-step-details">
              <legend>Details</legend>
              <label htmlFor={`${baseId}-application`}>
                Application
                <select
                  id={`${baseId}-application`}
                  required
                  value={form.applicationId}
                  data-testid="connection-application"
                  onChange={(event) => {
                    const next = applyApplicationSelection(form, event.target.value, projects);
                    setForm(next);
                    setTestSucceeded(false);
                    setTestResult(null);
                  }}
                >
                  <option value="">Select application</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${baseId}-name`}>
                Connection name
                <input
                  id={`${baseId}-name`}
                  required
                  maxLength={120}
                  value={form.name}
                  data-testid="connection-name"
                  onChange={(event) => updateForm({ name: event.target.value, nameManuallyEdited: true })}
                />
              </label>
              <label htmlFor={`${baseId}-environment`}>
                Environment
                <select
                  id={`${baseId}-environment`}
                  value={form.environment}
                  data-testid="connection-environment"
                  onChange={(event) => {
                    const next = applyEnvironmentChange(
                      form,
                      event.target.value as GuidedConnectionForm["environment"],
                      projects
                    );
                    setForm(next);
                    setTestSucceeded(false);
                    setTestResult(null);
                  }}
                >
                  {CONNECTION_ENVIRONMENTS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${baseId}-method`}>
                Method
                <select
                  id={`${baseId}-method`}
                  value={form.method}
                  data-testid="connection-method"
                  onChange={(event) =>
                    updateForm({ method: event.target.value as GuidedConnectionForm["method"] })
                  }
                >
                  {CONNECTION_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ) : null}

          {step === 2 ? (
            <fieldset className="connection-wizard__step" data-testid="connection-step-configuration">
              <legend>Configuration</legend>
              {isRestMethod(form.method) ? (
                <>
                  <label htmlFor={`${baseId}-base-url`}>
                    Base URL
                    <input
                      id={`${baseId}-base-url`}
                      type="url"
                      required
                      value={form.baseUrl}
                      data-testid="connection-base-url"
                      placeholder="https://api.example.com"
                      onChange={(event) => updateForm({ baseUrl: event.target.value })}
                    />
                  </label>
                  <label htmlFor={`${baseId}-health-path`}>
                    Health path
                    <input
                      id={`${baseId}-health-path`}
                      required
                      value={form.healthPath}
                      data-testid="connection-health-path"
                      placeholder="/health"
                      onChange={(event) => updateForm({ healthPath: event.target.value })}
                    />
                  </label>
                  <label htmlFor={`${baseId}-auth-type`}>
                    Authentication
                    <select
                      id={`${baseId}-auth-type`}
                      value={form.authType}
                      data-testid="connection-auth-type"
                      onChange={(event) =>
                        updateForm({ authType: event.target.value as GuidedConnectionForm["authType"] })
                      }
                    >
                      {AUTH_TYPES.map((auth) => (
                        <option key={auth.value} value={auth.value}>
                          {auth.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {authRequiresSecret(form.authType) ? (
                    <div className="connection-secret-field" data-testid="connection-auth-secret-field">
                      <label htmlFor={`${baseId}-auth-secret`}>
                        {form.authType === "BASIC" ? "Password / secret" : "API key / secret"}
                        <input
                          id={`${baseId}-auth-secret`}
                          type={showSecret ? "text" : "password"}
                          autoComplete="new-password"
                          value={form.authSecret}
                          data-testid="connection-auth-secret"
                          placeholder={editingConnectionId ? "Leave blank to keep existing secret" : "Write-only — never shown again"}
                          onChange={(event) => updateForm({ authSecret: event.target.value })}
                        />
                      </label>
                      <div className="connection-secret-field__actions">
                        <button type="button" className="secondary-button" onClick={() => setShowSecret((value) => !value)}>
                          {showSecret ? "Hide" : "Show"}
                        </button>
                        <button type="button" className="secondary-button" onClick={() => void onPasteSecret()}>
                          Paste
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {authShowsHeaderName(form.authType) ? (
                    <label htmlFor={`${baseId}-header-name`} data-testid="connection-header-name-field">
                      Header name
                      <input
                        id={`${baseId}-header-name`}
                        value={form.authHeaderName}
                        data-testid="connection-header-name"
                        placeholder={form.authType === "API_KEY" ? "X-API-Key" : "X-Custom-Token"}
                        onChange={(event) => updateForm({ authHeaderName: event.target.value })}
                      />
                    </label>
                  ) : null}
                  {authShowsPrefix(form.authType) ? (
                    <label htmlFor={`${baseId}-prefix`} data-testid="connection-auth-prefix-field">
                      Optional prefix
                      <input
                        id={`${baseId}-prefix`}
                        value={form.authPrefix}
                        data-testid="connection-auth-prefix"
                        placeholder={form.authType === "BEARER" ? "Bearer" : ""}
                        onChange={(event) => updateForm({ authPrefix: event.target.value })}
                      />
                    </label>
                  ) : null}
                  <label htmlFor={`${baseId}-timeout`}>
                    Timeout
                    <select
                      id={`${baseId}-timeout`}
                      value={form.timeoutSeconds}
                      data-testid="connection-timeout"
                      onChange={(event) =>
                        updateForm({ timeoutSeconds: Number(event.target.value) as TimeoutSeconds })
                      }
                    >
                      {TIMEOUT_OPTIONS_SECONDS.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds} seconds
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor={`${baseId}-discovery`}>
                    Discovery path (optional)
                    <input
                      id={`${baseId}-discovery`}
                      value={form.discoveryPath}
                      data-testid="connection-discovery-path"
                      placeholder="/api/v1/integrations/ping"
                      onChange={(event) => updateForm({ discoveryPath: event.target.value })}
                    />
                  </label>
                </>
              ) : (
                <p className="dashboard-subtle" data-testid="connection-non-rest-note">
                  {CONNECTION_METHODS.find((row) => row.value === form.method)?.label} connections use the application
                  and environment from step 1. Advanced overrides are available below if your connector needs them.
                </p>
              )}

              <details
                className="connection-advanced"
                data-testid="connection-advanced"
                open={showAdvanced}
                onToggle={(event) => setShowAdvanced((event.target as HTMLDetailsElement).open)}
              >
                <summary>Advanced details</summary>
                <div className="advanced-panel">
                  <label>
                    Mode override
                    <input
                      value={form.advancedMode}
                      data-testid="connection-advanced-mode"
                      placeholder="Leave blank to use method default"
                      onChange={(event) => updateForm({ advancedMode: event.target.value })}
                    />
                  </label>
                  <label>
                    Type override
                    <input
                      value={form.advancedType}
                      data-testid="connection-advanced-type"
                      onChange={(event) => updateForm({ advancedType: event.target.value })}
                    />
                  </label>
                  <label>
                    Auth method override
                    <input
                      value={form.advancedAuthMethod}
                      data-testid="connection-advanced-auth"
                      onChange={(event) => updateForm({ advancedAuthMethod: event.target.value })}
                    />
                  </label>
                  <label>
                    Header name override
                    <input
                      value={form.advancedHeaderName}
                      data-testid="connection-advanced-header"
                      onChange={(event) => updateForm({ advancedHeaderName: event.target.value })}
                    />
                  </label>
                  <label>
                    Raw timeout (ms)
                    <input
                      value={form.advancedTimeoutMs}
                      data-testid="connection-advanced-timeout"
                      inputMode="numeric"
                      placeholder="1–30000"
                      onChange={(event) => updateForm({ advancedTimeoutMs: event.target.value })}
                    />
                  </label>
                  <label>
                    Credential reference
                    <input
                      value={form.credentialReference}
                      data-testid="connection-credential-reference"
                      placeholder="env://OPTIONAL_LEGACY_REF"
                      onChange={(event) => updateForm({ credentialReference: event.target.value })}
                    />
                  </label>
                </div>
              </details>
            </fieldset>
          ) : null}

          {step === 3 ? (
            <fieldset className="connection-wizard__step" data-testid="connection-step-test-save">
              <legend>Test and save</legend>
              <p className="dashboard-subtle">
                Test against the live endpoint before monitoring. OpsWatch never fakes a successful result.
              </p>
              <div className="connection-wizard__actions">
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="connection-test-button"
                  disabled={busy !== "idle"}
                  onClick={() => void runUnsavedTest()}
                >
                  {busy === "testing" ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="connection-save-draft-button"
                  disabled={busy !== "idle"}
                  onClick={() => void saveDraft()}
                >
                  {busy === "saving" ? "Saving…" : "Save without testing"}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  data-testid="connection-save-monitor-button"
                  disabled={busy !== "idle" || !testSucceeded}
                  onClick={() => void saveAndStartMonitoring()}
                >
                  {busy === "monitoring" ? "Starting…" : "Save and start monitoring"}
                </button>
              </div>

              {testResult ? (
                <div
                  className={`connection-test-result ${connectionTestPassed(testResult) ? "connection-test-result--ok" : "connection-test-result--fail"}`}
                  data-testid="connection-test-result"
                  role="status"
                >
                  <h3>{connectionTestPassed(testResult) ? "Test passed" : "Test failed"}</h3>
                  <dl>
                    <div>
                      <dt>HTTP status</dt>
                      <dd>{testResult.statusCode ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Latency</dt>
                      <dd>{formatLatency(testResult.responseTimeMs)}</dd>
                    </div>
                    <div>
                      <dt>Authentication</dt>
                      <dd>
                        {testResult.authenticationPassed == null
                          ? "—"
                          : testResult.authenticationPassed
                            ? "Passed"
                            : "Failed"}
                      </dd>
                    </div>
                    <div>
                      <dt>Health</dt>
                      <dd>
                        {testResult.healthPassed == null ? "—" : testResult.healthPassed ? "Passed" : "Failed"}
                      </dd>
                    </div>
                    <div>
                      <dt>Discovery</dt>
                      <dd>
                        {testResult.discoveryPassed == null
                          ? "—"
                          : testResult.discoveryPassed
                            ? "Passed"
                            : "Failed"}
                      </dd>
                    </div>
                    <div>
                      <dt>Discovered services</dt>
                      <dd>
                        {discovered.length === 0
                          ? "None"
                          : `${discovered.length}: ${discovered.join(", ")}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Validated at</dt>
                      <dd>
                        {testResult.validatedAt ? new Date(testResult.validatedAt).toLocaleString() : "—"}
                      </dd>
                    </div>
                  </dl>
                  {testResult.error || testResult.errorCategory ? (
                    <p>{testResult.error || testResult.errorCategory}</p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          ) : null}

          <div className="connection-wizard__nav">
            <button
              type="button"
              className="secondary-button"
              disabled={step === 1 || busy !== "idle"}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
              Back
            </button>
            {step < 3 ? (
              <button type="button" className="primary-button" onClick={goNext}>
                Continue
              </button>
            ) : null}
          </div>
        </form>

        <ConnectionWizardSummary form={form} projects={projects} step={step} testSucceeded={testSucceeded} />
      </div>
    </section>
  );
}
