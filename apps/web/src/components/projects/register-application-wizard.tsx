"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { resolvePublicIngestApiUrl } from "../../lib/public-ingest-api-url";
import { formatApplicationId } from "../../lib/application-id";
import type { ProjectTopologyResponse } from "../topology/topology-types";
import {
  AuthenticationPanel,
  CopyFeedbackButton,
  CredentialCopyField,
  EnvSnippetBlock
} from "./register-wizard-ui";
import {
  MonitoringDepthSummary,
  type MonitoringSetup
} from "./monitoring-depth-summary";

type WizardStep = "register" | "success" | "credentials" | "verification" | "discover" | "monitoring";

type IngestCredentials = {
  apiKey?: string;
  signingSecret?: string;
  signingSecretConfigured?: boolean;
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
  status?: string;
  frontendUrl?: string | null;
  adminUrl?: string | null;
  monitoringSetup?: MonitoringSetup;
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
  status?: string;
  heartbeats?: HeartbeatRow[];
  monitoringSetup?: MonitoringSetup;
};

type ServiceRow = {
  id: string;
  name: string;
  type: string;
};

type DiscoverySnapshot = {
  modules: number;
  workflows: number;
  components: number;
  services: number;
  dependencies: number;
  discoveredLabels: string[];
};

type RegisterForm = {
  name: string;
  clientName: string;
  environment: string;
  publicUrl: string;
  adminUrl: string;
};

type ClientMode = "none" | "existing" | "new";

type JourneyStep = {
  id: string;
  label: string;
  status: "done" | "current" | "upcoming";
};

const SDK_PACKAGE = "@opswatch/client";
const HEARTBEAT_POLL_MS = 5000;
const DISCOVERY_POLL_MS = 3000;

const JOURNEY_LABELS = ["Register", "Connect", "Heartbeat", "Topology", "Configure", "Monitoring"] as const;

const DISCOVERY_TARGETS = ["API", "Database", "Redis", "Queue", "Background workers", "Modules", "Workflows"] as const;

const EMPTY_FORM: RegisterForm = {
  name: "",
  clientName: "",
  environment: "development",
  publicUrl: "",
  adminUrl: ""
};

const buildSetupEnv = (input: {
  apiKey: string;
  signingSecret: string;
  projectSlug: string;
  publicUrl?: string;
}): string => {
  const lines = [
    `OPSWATCH_API_URL=${resolvePublicIngestApiUrl()}`,
    `OPSWATCH_API_KEY=${input.apiKey}`,
    `OPSWATCH_SIGNING_SECRET=${input.signingSecret}`,
    `OPSWATCH_PROJECT_SLUG=${input.projectSlug}`
  ];
  if (input.publicUrl?.trim()) {
    lines.push(`APP_PUBLIC_URL=${input.publicUrl.trim()}`);
  }
  return `${lines.join("\n")}\n`;
};

const journeyIndexForStep = (step: WizardStep): number => {
  switch (step) {
    case "success":
    case "credentials":
      return 1;
    case "verification":
      return 2;
    case "discover":
      return 3;
    case "monitoring":
      return 5;
    default:
      return 0;
  }
};

const getJourneySteps = (step: WizardStep): JourneyStep[] => {
  const activeIndex = journeyIndexForStep(step);
  return JOURNEY_LABELS.map((label, index) => ({
    id: label.toLowerCase(),
    label,
    status: index < activeIndex ? "done" : index === activeIndex ? "current" : "upcoming"
  }));
};

const buildDiscoverySnapshot = (topology: ProjectTopologyResponse | null, services: ServiceRow[]): DiscoverySnapshot => {
  const nodes = topology?.nodes ?? [];
  const modules = nodes.filter((node) => node.type === "MODULE").length;
  const workflows = nodes.filter((node) => node.type === "WORKFLOW").length;
  const components = nodes.filter((node) => node.type === "COMPONENT").length;
  const dependencies = topology?.edges.filter((edge) => edge.type === "DEPENDENCY").length ?? 0;

  const serviceLabels = services.map((service) => service.name);
  const typeLabels = [...new Set(services.map((service) => service.type))];

  const discoveredLabels = [
    ...serviceLabels.slice(0, 5),
    ...(modules > 0 ? [`${modules} module${modules === 1 ? "" : "s"}`] : []),
    ...(workflows > 0 ? [`${workflows} workflow${workflows === 1 ? "" : "s"}`] : []),
    ...typeLabels.filter((type) => !serviceLabels.includes(type))
  ];

  return {
    modules,
    workflows,
    components,
    services: services.length,
    dependencies,
    discoveredLabels: [...new Set(discoveredLabels)].slice(0, 8)
  };
};

const matchDiscoveryTarget = (target: string, snapshot: DiscoverySnapshot, services: ServiceRow[]): boolean => {
  const haystack = [
    ...snapshot.discoveredLabels,
    ...services.map((service) => `${service.name} ${service.type}`)
  ]
    .join(" ")
    .toLowerCase();

  const needle = target.toLowerCase();
  if (needle === "api") return haystack.includes("api") || snapshot.services > 0;
  if (needle === "database") return haystack.includes("database") || haystack.includes("db");
  if (needle === "redis") return haystack.includes("redis");
  if (needle === "queue") return haystack.includes("queue");
  if (needle === "background workers") return haystack.includes("worker") || haystack.includes("background");
  if (needle === "modules") return snapshot.modules > 0;
  if (needle === "workflows") return snapshot.workflows > 0;
  return false;
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
  const heartbeatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [step, setStep] = useState<WizardStep>("register");
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [clientMode, setClientMode] = useState<ClientMode>("none");
  const [selectedClient, setSelectedClient] = useState("");
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [orgStatus, setOrgStatus] = useState<"loading" | "ready" | "error">("loading");
  const [orgError, setOrgError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateApplicationResponse | null>(null);
  const [connection, setConnection] = useState<ProjectConnection | null>(null);
  const [topology, setTopology] = useState<ProjectTopologyResponse | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [waitingForHeartbeat, setWaitingForHeartbeat] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [retryingMonitoring, setRetryingMonitoring] = useState(false);

  const credentials = created?.ingestCredentials;
  const hasCredentials = Boolean(credentials && !credentials.error && credentials.apiKey);
  const latestHeartbeat = connection?.heartbeats?.[0] ?? null;
  const isConnected = Boolean(latestHeartbeat);
  const applicationId = created ? formatApplicationId(created.id) : "";
  const journeySteps = getJourneySteps(step);
  const discovery = useMemo(() => buildDiscoverySnapshot(topology, services), [topology, services]);
  const monitoringSetup = connection?.monitoringSetup ?? created?.monitoringSetup ?? null;

  const clientSuggestions = useMemo(
    () => [...new Set(knownClients.map((value) => value.trim()).filter(Boolean))].sort(),
    [knownClients]
  );

  const resolvedClientName = useMemo(() => {
    if (clientMode === "existing") return selectedClient.trim();
    if (clientMode === "new") return form.clientName.trim();
    return "";
  }, [clientMode, form.clientName, selectedClient]);

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

  const loadOrganization = useCallback(async () => {
    setOrgStatus("loading");
    setOrgError(null);
    try {
      const next = await apiFetch<OrgSummary>("/org");
      setOrg(next);
      setOrgStatus("ready");
    } catch (err: unknown) {
      setOrg(null);
      setOrgStatus("error");
      const message = err instanceof Error ? err.message : "Failed to load organization";
      const missingOrg =
        /organization required/i.test(message) ||
        /organization not found/i.test(message);
      setOrgError(
        missingOrg
          ? "Your account is not linked to an organization. Open Organization or ask an admin on Members to attach your user, then retry."
          : message
      );
    }
  }, []);

  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);

  const stopHeartbeatPolling = useCallback(() => {
    if (heartbeatPollRef.current) {
      clearInterval(heartbeatPollRef.current);
      heartbeatPollRef.current = null;
    }
    setWaitingForHeartbeat(false);
  }, []);

  const stopDiscoveryPolling = useCallback(() => {
    if (discoveryPollRef.current) {
      clearInterval(discoveryPollRef.current);
      discoveryPollRef.current = null;
    }
    setDiscovering(false);
  }, []);

  const loadDiscovery = useCallback(async (projectId: string) => {
    try {
      const [topologyResult, servicesResult] = await Promise.allSettled([
        apiFetch<ProjectTopologyResponse>(`/projects/${projectId}/topology`),
        apiFetch<ServiceRow[]>(`/projects/${projectId}/services`)
      ]);
      if (topologyResult.status === "fulfilled") setTopology(topologyResult.value);
      if (servicesResult.status === "fulfilled") setServices(servicesResult.value);
    } catch {
      // Discovery polling is best-effort during onboarding.
    }
  }, []);

  const pollHeartbeat = useCallback(
    async (projectId: string) => {
      try {
        const project = await apiFetch<ProjectConnection>(`/projects/${projectId}`);
        setConnection(project);
        if (project.heartbeats?.length) {
          stopHeartbeatPolling();
          setStep("discover");
        }
      } catch {
        // Keep polling until heartbeat arrives or user skips.
      }
    },
    [stopHeartbeatPolling]
  );

  const loadProjectState = useCallback(async (projectId: string) => {
    try {
      const project = await apiFetch<ProjectConnection>(`/projects/${projectId}`);
      setConnection(project);
    } catch {
      // Monitoring setup polling is best-effort; explicit retries surface errors.
    }
  }, []);

  useEffect(() => {
    if (step === "register" || !created?.id) return;
    void loadProjectState(created.id);
    const timer = setInterval(() => {
      void loadProjectState(created.id);
    }, DISCOVERY_POLL_MS);
    return () => clearInterval(timer);
  }, [created?.id, loadProjectState, step]);

  useEffect(() => {
    if (step !== "verification" || !created?.id) {
      stopHeartbeatPolling();
      return;
    }

    setWaitingForHeartbeat(true);
    void pollHeartbeat(created.id);
    heartbeatPollRef.current = setInterval(() => {
      void pollHeartbeat(created.id);
    }, HEARTBEAT_POLL_MS);

    return () => stopHeartbeatPolling();
  }, [created?.id, pollHeartbeat, step, stopHeartbeatPolling]);

  useEffect(() => {
    if (step !== "discover" || !created?.id) {
      stopDiscoveryPolling();
      return;
    }

    setDiscovering(true);
    void loadDiscovery(created.id);
    discoveryPollRef.current = setInterval(() => {
      void loadDiscovery(created.id);
    }, DISCOVERY_POLL_MS);

    return () => stopDiscoveryPolling();
  }, [created?.id, loadDiscovery, step, stopDiscoveryPolling]);

  useEffect(() => {
    if (step === "monitoring" && created?.id) {
      void loadDiscovery(created.id);
    }
  }, [created?.id, loadDiscovery, step]);

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
          clientName: resolvedClientName || form.name.trim(),
          environment: form.environment,
          frontendUrl: form.publicUrl.trim() || undefined,
          adminUrl: form.adminUrl.trim() || undefined,
          monitoringEnabled: true,
          automationMode: "MONITOR_ONLY"
        })
      });

      setCreated(response);
      setConnection(response);

      if (response.ingestCredentials?.error) {
        setError(response.ingestCredentials.error);
        setStep("success");
        await onCreated();
        return;
      }

      if (!response.ingestCredentials?.apiKey && !response.ingestCredentials?.reused) {
        setError("Application registered but ingest credentials were not returned. Continue to connection settings.");
      }

      setStep("success");
      await onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register application");
    } finally {
      setSaving(false);
    }
  };

  const retryMonitoringSetup = async () => {
    if (!created?.id) return;
    setRetryingMonitoring(true);
    setError(null);
    try {
      const project = await apiFetch<ProjectConnection>(`/projects/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(form.publicUrl.trim() ? { frontendUrl: form.publicUrl.trim() } : {}),
          ...(form.adminUrl.trim() ? { adminUrl: form.adminUrl.trim() } : {})
        })
      });
      setConnection(project);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Monitoring setup retry failed");
    } finally {
      setRetryingMonitoring(false);
    }
  };

  const copyApiKey = async () => {
    if (!credentials?.apiKey) return;
    await navigator.clipboard.writeText(credentials.apiKey);
  };

  const copySigningSecret = async () => {
    if (!credentials?.signingSecret) return;
    await navigator.clipboard.writeText(credentials.signingSecret);
  };

  const copyCredentials = async () => {
    if (!setupEnv) return;
    await navigator.clipboard.writeText(setupEnv);
  };

  const downloadSetup = async () => {
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
    stopHeartbeatPolling();
    stopDiscoveryPolling();
    onClose();
  };

  const stepTitle =
    step === "register"
      ? "Register application"
      : step === "success"
        ? "Application registered"
        : step === "credentials"
          ? "Connect application"
          : step === "verification"
            ? "Waiting for heartbeat"
            : step === "discover"
              ? "Review topology"
              : "Application connected successfully";

  const stepDescription =
    step === "register"
      ? "Register an application. A public URL starts external monitoring without an agent; heartbeat setup remains optional."
      : step === "success"
        ? "Copy your API key now, then connect your application to OpsWatch."
        : step === "credentials"
          ? "Use these credentials to wire up the SDK and start sending heartbeats."
          : step === "verification"
            ? "After the first heartbeat, this application is Connected."
            : step === "discover"
              ? "Topology comes from a discovery payload, seed data, or services you add — not from the heartbeat alone."
              : "Your application is connected to OpsWatch.";

  const healthStatus = connection?.status ?? created?.status ?? topology?.project.status ?? "UNKNOWN";
  const healthLabel =
    healthStatus === "HEALTHY"
      ? "Healthy"
      : healthStatus === "UNKNOWN"
        ? "Waiting for first heartbeat"
        : healthStatus.charAt(0) + healthStatus.slice(1).toLowerCase();

  return (
    <div className="register-wizard">
      <div className="section-head">
        <div>
          <h2>{stepTitle}</h2>
          <p>{stepDescription}</p>
        </div>
        {step !== "register" ? (
          <button type="button" className="secondary-button" onClick={closeWizard} data-action="local-ui">
            Cancel
          </button>
        ) : null}
      </div>

      {step !== "register" ? (
        <div className="register-wizard-journey" aria-label="Onboarding journey">
          {journeySteps.map((journeyStep) => (
            <div
              key={journeyStep.id}
              className={`register-wizard-step register-wizard-step--${journeyStep.status}`}
            >
              <span className="register-wizard-step-number">
                {journeyStep.status === "done" ? "✓" : journeyStep.status === "current" ? "▶" : "○"}
              </span>
              <span>{journeyStep.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="error-panel" style={{ marginBottom: "1rem" }}>{error}</div> : null}

      {step === "register" ? (
        <form className="stack-form register-wizard-form" onSubmit={(event) => void registerApplication(event)}>
          <label>
            Application name *
            <input
              value={form.name}
              onChange={(event) => updateName(event.target.value)}
              placeholder="e.g. Noble Express, TrueNumeris, Sparkle, GlowLive Engine"
              required
              autoFocus
            />
          </label>

          <label>
            Organization *
            <div
              className={`register-org-readonly${orgStatus === "error" ? " register-org-readonly--error" : ""}`}
              aria-readonly="true"
              aria-busy={orgStatus === "loading"}
            >
              <span>
                {orgStatus === "loading"
                  ? "Loading organization…"
                  : orgStatus === "ready" && org
                    ? org.name
                    : "Organization unavailable"}
              </span>
              {orgStatus === "ready" ? (
                <span className="register-org-lock" title="Organization is fixed for your workspace" aria-hidden="true">
                  🔒
                </span>
              ) : null}
            </div>
            {orgStatus === "error" ? (
              <span className="field-hint field-hint--spaced warn-text">
                {orgError ?? "Could not load your organization."}{" "}
                <a href="/org">Organization settings</a>
                {" · "}
                <a href="/members">Members</a>
                {" · "}
                <button type="button" className="link-button" onClick={() => void loadOrganization()} data-action="local-ui">
                  Retry
                </button>
              </span>
            ) : null}
          </label>

          <label>
            Client / business unit (optional)
            <select
              value={clientMode}
              onChange={(event) => {
                const mode = event.target.value as ClientMode;
                setClientMode(mode);
                if (mode === "existing" && clientSuggestions.length > 0 && !selectedClient) {
                  setSelectedClient(clientSuggestions[0] ?? "");
                }
                if (mode !== "new") {
                  setForm((current) => ({ ...current, clientName: "" }));
                }
              }}
            >
              <option value="none">— None —</option>
              <option value="existing" disabled={clientSuggestions.length === 0}>
                Select existing…
              </option>
              <option value="new">+ New client / business unit</option>
            </select>
          </label>

          {clientMode === "existing" ? (
            <label>
              Existing client / business unit
              <select value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}>
                {clientSuggestions.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {clientMode === "new" ? (
            <label>
              New client / business unit
              <input
                value={form.clientName}
                onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))}
                placeholder="Noble Express Courier Services Ltd"
              />
            </label>
          ) : null}

          <label>
            Environment *
            <select
              value={form.environment}
              onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
            >
              <option value="development">Development</option>
              <option value="testing">Testing</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </label>

          <label htmlFor="register-public-url">
            Public application URL (optional)
            <input
              id="register-public-url"
              value={form.publicUrl}
              onChange={(event) => setForm((current) => ({ ...current, publicUrl: event.target.value }))}
              placeholder="https://your-domain.com"
              type="url"
            />
            <span className="field-hint field-hint--spaced">
              Uses safe external HTTP and SSL checks. No agent or SDK required.
            </span>
          </label>

          <label htmlFor="register-admin-url">
            Admin URL (optional)
            <input
              id="register-admin-url"
              value={form.adminUrl}
              onChange={(event) => setForm((current) => ({ ...current, adminUrl: event.target.value }))}
              placeholder="https://admin.your-domain.com"
              type="url"
            />
            <span className="field-hint field-hint--spaced">
              Reachability and TLS only. Do not enter administrator credentials.
            </span>
          </label>

          <div className="register-wizard-form-actions">
            <button type="button" className="secondary-button" onClick={closeWizard} data-action="local-ui">
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || orgStatus !== "ready" || !org}
              data-action="api"
              data-endpoint="/projects"
            >
              {saving ? "Registering…" : "Register application"}
            </button>
          </div>
        </form>
      ) : null}

      {step === "success" && created ? (
        <div className="stack-form">
          <div className="register-wizard-success-banner">
            <strong>✓ {created.name} registered</strong>
            <p>
              {monitoringSetup?.status === "ACTIVE"
                ? "External monitoring is active."
                : form.publicUrl.trim()
                  ? "Setting up external monitoring…"
                  : "External monitoring is not configured."}
            </p>
          </div>

          {monitoringSetup ? (
            <MonitoringDepthSummary
              setup={monitoringSetup}
              onRetry={() => void retryMonitoringSetup()}
              retrying={retryingMonitoring}
            />
          ) : null}

          <label>
            Application ID
            <input value={applicationId} readOnly />
          </label>

          {hasCredentials && credentials?.apiKey ? (
            <CredentialCopyField
              label="API key"
              value={credentials.apiKey}
              warning="This API key is shown only once. Copy it now. You won&apos;t be able to view it again."
            />
          ) : (
            <p className="warn-text">No new API key was issued. You can create one under Organization settings.</p>
          )}

          <div className="hint-panel register-wizard-next-step">
            <strong>Next step</strong>
            <p>Connect your application using the API key above.</p>
            <p>
              URL checks work independently. A later heartbeat adds internal application liveness; modules and
              workflows still require discovery data or services you add.
            </p>
          </div>

          <div className="register-wizard-form-actions">
            <button type="button" className="primary-button" onClick={() => setStep("credentials")} data-action="local-ui">
              Continue →
            </button>
          </div>
        </div>
      ) : null}

      {step === "credentials" && created ? (
        <div className="stack-form">
          <div className="hint-panel register-wizard-next-step">
            <strong>Paste into Noble Integration Centre</strong>
            <p>
              Admin → Integrations → OpsWatch. Use Base URL, API key, Signing secret, and{" "}
              <strong>Project slug</strong> below. Application ID (OW-APP-…) is display-only and will not authenticate
              heartbeats.
            </p>
          </div>

          <label>
            Project slug
            <input value={credentials?.projectSlug ?? created.slug ?? ""} readOnly />
          </label>

          <CredentialCopyField label="Base URL" value={resolvePublicIngestApiUrl()} />

          <label>
            Application ID (display only)
            <input value={applicationId} readOnly />
          </label>

          {hasCredentials && credentials?.apiKey ? (
            <CredentialCopyField
              label="API key"
              value={credentials.apiKey}
              warning="This API key is shown only once. Copy it now. You won&apos;t be able to view it again."
            />
          ) : null}

          {credentials?.signingSecret ? (
            <CredentialCopyField
              label="Signing secret"
              value={credentials.signingSecret}
              warning="This signing secret is shown only once. Copy it now. You won&apos;t be able to view it again."
            />
          ) : credentials?.signingSecretConfigured ? (
            <div className="hint-panel" data-testid="signing-secret-configured">
              <strong>Signing secret already configured</strong>
              <p>The signing secret for this application was provisioned earlier and cannot be shown again.</p>
            </div>
          ) : null}

          <label>
            SDK
            <input value={SDK_PACKAGE} readOnly />
          </label>

          <AuthenticationPanel />

          {setupEnv ? <EnvSnippetBlock snippet={setupEnv} onCopy={copyCredentials} /> : null}

          <div className="register-wizard-form-actions">
            {setupEnv ? (
              <>
                <CopyFeedbackButton idleLabel="Copy credentials" successLabel="✓ Copied" onAction={copyCredentials} />
                <CopyFeedbackButton idleLabel="Download setup" successLabel="✓ Downloaded" onAction={downloadSetup} />
              </>
            ) : null}
            <button type="button" className="primary-button" onClick={() => setStep("verification")} data-action="local-ui">
              Continue →
            </button>
          </div>
        </div>
      ) : null}

      {step === "verification" && created ? (
        <div className="stack-form">
          {isConnected ? (
            <div className="register-heartbeat-connected">
              <strong>✓ First heartbeat received</strong>
              <p>Your application is Connected.</p>
            </div>
          ) : (
            <div className="register-heartbeat-waiting">
              <span className="register-heartbeat-pulse" aria-hidden="true">
                ●
              </span>
              <div>
                <strong>Waiting for heartbeat…</strong>
                <p>Send a heartbeat from the SDK to mark this application Connected.</p>
                <p className="field-hint">Checking every 5 seconds…</p>
              </div>
            </div>
          )}

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
              <li>Add topology via discovery payload, seed, or Modules / Components pages.</li>
            </ol>
          </div>

          <div className="register-wizard-form-actions">
            <button type="button" className="secondary-button" onClick={() => setStep("credentials")} data-action="local-ui">
              Back
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                stopHeartbeatPolling();
                setStep(isConnected ? "discover" : "monitoring");
              }}
              data-action="local-ui"
            >
              {isConnected ? "Continue →" : "Skip for now"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "discover" && created ? (
        <div className="stack-form">
          <div className="register-discovery-banner">
            <span className={`register-heartbeat-pulse${discovering ? "" : " register-heartbeat-pulse--idle"}`} aria-hidden="true">
              ●
            </span>
            <div>
              <strong>Topology so far</strong>
              <p>
                Showing modules, workflows, and services already registered (discovery payload, seed, or added in the
                UI). Heartbeat alone does not invent this graph.
              </p>
            </div>
          </div>

          <ul className="register-wizard-checklist register-discovery-list">
            {DISCOVERY_TARGETS.map((target) => {
              const found = matchDiscoveryTarget(target, discovery, services);
              return (
                <li key={target} className={found ? "done" : discovering ? "pending" : ""}>
                  {found ? "✓" : discovering ? "○" : "○"} {target}
                </li>
              );
            })}
            {discovery.discoveredLabels.map((label) => (
              <li key={label} className="done">
                ✓ {label}
              </li>
            ))}
          </ul>

          <div className="register-wizard-form-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                stopDiscoveryPolling();
                setStep("monitoring");
              }}
              data-action="local-ui"
            >
              Continue →
            </button>
          </div>
        </div>
      ) : null}

      {step === "monitoring" && created ? (
        <div className="stack-form">
          <div className="register-wizard-success-banner register-wizard-success-banner--celebrate">
            <strong>Application onboarding complete</strong>
            <p>Only the monitoring areas shown as active below are connected.</p>
          </div>

          <div className="hint-panel register-wizard-next-step">
            <strong>Next</strong>
            <ul className="register-wizard-inline-list">
              <li>External monitoring runs from configured URL checks.</li>
              <li>Application monitoring remains independent and can be connected later.</li>
            </ul>
          </div>

          {monitoringSetup ? (
            <MonitoringDepthSummary
              setup={monitoringSetup}
              onRetry={() => void retryMonitoringSetup()}
              retrying={retryingMonitoring}
            />
          ) : null}

          <div className="register-monitoring-preview">
            <div className="register-monitoring-row">
              <span>Application health</span>
              <strong>{healthLabel}</strong>
            </div>
            <div className="register-monitoring-row">
              <span>Modules</span>
              <strong>{discovery.modules}</strong>
            </div>
            <div className="register-monitoring-row">
              <span>Services</span>
              <strong>{discovery.services}</strong>
            </div>
            <div className="register-monitoring-row">
              <span>Workflows</span>
              <strong>{discovery.workflows}</strong>
            </div>
            <div className="register-monitoring-row">
              <span>Dependencies</span>
              <strong>{discovery.dependencies}</strong>
            </div>
          </div>

          <p className="field-hint">Logs, traces, infrastructure, events, and heartbeat remain separate connections.</p>

          <div className="register-wizard-form-actions">
            <button type="button" className="secondary-button" onClick={closeWizard} data-action="local-ui">
              Close
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => router.push("/dashboard")}
              data-action="local-ui"
            >
              Open command center
            </button>
            <button type="button" className="primary-button" onClick={() => router.push(`/projects/${created.id}`)} data-action="local-ui">
              Open application
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
