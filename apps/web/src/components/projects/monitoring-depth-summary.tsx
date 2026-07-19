"use client";

export type MonitoringSetup = {
  status: "NOT_CONFIGURED" | "SETTING_UP" | "ACTIVE" | "FAILED";
  error?: string | null;
  steps: {
    websiteConnectionCreated: boolean;
    httpCheckScheduled: boolean;
    sslCheckScheduled: boolean;
    firstCheckPending: boolean;
    monitoringActive: boolean;
  };
  depth: {
    externalMonitoring: {
      publicUrlConnected: boolean;
      httpMonitoringActive: boolean;
      sslMonitoringActive: boolean;
      adminUrlMonitoring: "ACTIVE" | "PENDING" | "NOT_CONFIGURED";
    };
    applicationMonitoring: {
      heartbeat: "CONNECTED" | "NOT_CONFIGURED";
      events: "CONNECTED" | "NOT_CONFIGURED";
    };
    advancedMonitoring: {
      logs: string;
      traces: string;
      infrastructure: string;
      otel?: {
        connections: number;
        connectionHealth: string | null;
        lastSignalAt: string | null;
        signalCounts: {
          metric: number;
          log: number;
          trace: number;
          span: number;
          error: number;
          dependency: number;
          total: number;
        };
        discoveredEntities: number;
        discoveredRelationships: number;
        staleEntities: number;
        ingestionEnabled: boolean;
        topologyDiscoveryEnabled: boolean;
        alertGenerationEnabled: boolean;
        incidentCorrelationEnabled: boolean;
        processingNotes: string[];
        label: string;
      } | null;
    };
  };
};

const stateLabel = (value: string | null | undefined): string => {
  if (!value) return "Unknown";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
};

const BoolState = ({
  active,
  activeLabel,
  inactiveLabel
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) => (
  <strong className={active ? "success-text" : "dashboard-subtle"}>
    {active ? activeLabel : inactiveLabel}
  </strong>
);

const FlagState = ({ enabled }: { enabled: boolean }) => (
  <strong className={enabled ? "success-text" : "dashboard-subtle"}>
    {enabled ? "Enabled" : "Disabled"}
  </strong>
);

export function MonitoringDepthSummary({
  setup,
  onRetry,
  retrying = false
}: {
  setup: MonitoringSetup;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const otel = setup.depth.advancedMonitoring.otel;

  return (
    <div className="monitoring-depth-summary" data-testid="monitoring-depth-summary">
      <div className="panel-heading-row">
        <div>
          <h3>Monitoring depth</h3>
          <p className="dashboard-subtle">
            External checks do not imply internal application visibility.
          </p>
        </div>
        <span
          className={`status-badge status-${setup.status === "ACTIVE" ? "healthy" : setup.status === "FAILED" ? "down" : "unknown"}`}
        >
          {stateLabel(setup.status)}
        </span>
      </div>

      {setup.status === "SETTING_UP" ? (
        <ul className="register-wizard-checklist">
          <li className={setup.steps.websiteConnectionCreated ? "done" : "pending"}>
            Website connection created
          </li>
          <li className={setup.steps.httpCheckScheduled ? "done" : "pending"}>HTTP check scheduled</li>
          <li className={setup.steps.sslCheckScheduled ? "done" : "pending"}>SSL check scheduled</li>
          <li
            className={
              setup.steps.firstCheckPending ? "pending" : setup.steps.monitoringActive ? "done" : ""
            }
          >
            {setup.steps.monitoringActive ? "Monitoring active" : "First check pending"}
          </li>
        </ul>
      ) : null}

      {setup.status === "FAILED" ? (
        <div className="error-panel" role="alert">
          <strong>Monitoring setup failed</strong>
          <p>{setup.error || "The monitoring worker could not complete setup."}</p>
          {onRetry ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onRetry}
              disabled={retrying}
              data-action="api"
            >
              {retrying ? "Retrying…" : "Retry setup"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="register-monitoring-preview">
        <div className="register-monitoring-row">
          <span>External · Public URL</span>
          <BoolState
            active={setup.depth.externalMonitoring.publicUrlConnected}
            activeLabel="Connected"
            inactiveLabel="Not configured"
          />
        </div>
        <div className="register-monitoring-row">
          <span>External · HTTP</span>
          <BoolState
            active={setup.depth.externalMonitoring.httpMonitoringActive}
            activeLabel="Active"
            inactiveLabel="Pending / not configured"
          />
        </div>
        <div className="register-monitoring-row">
          <span>External · SSL</span>
          <BoolState
            active={setup.depth.externalMonitoring.sslMonitoringActive}
            activeLabel="Active"
            inactiveLabel="Pending / not configured"
          />
        </div>
        <div className="register-monitoring-row">
          <span>External · Admin URL</span>
          <strong>{stateLabel(setup.depth.externalMonitoring.adminUrlMonitoring)}</strong>
        </div>
        <div className="register-monitoring-row">
          <span>Application · Heartbeat</span>
          <strong>{stateLabel(setup.depth.applicationMonitoring.heartbeat)}</strong>
        </div>
        <div className="register-monitoring-row">
          <span>Application · Events</span>
          <strong>{stateLabel(setup.depth.applicationMonitoring.events)}</strong>
        </div>
        <div className="register-monitoring-row">
          <span>Advanced · Logs (Foundation/Preview)</span>
          <strong data-testid="monitoring-depth-logs">
            {stateLabel(setup.depth.advancedMonitoring.logs)}
          </strong>
        </div>
        <div className="register-monitoring-row">
          <span>Advanced · Traces (Foundation/Preview)</span>
          <strong data-testid="monitoring-depth-traces">
            {stateLabel(setup.depth.advancedMonitoring.traces)}
          </strong>
        </div>
        <div className="register-monitoring-row">
          <span>Advanced · Infrastructure</span>
          <strong>{stateLabel(setup.depth.advancedMonitoring.infrastructure)}</strong>
        </div>
        {otel ? (
          <div data-testid="monitoring-depth-otel">
            <div className="register-monitoring-row">
              <span>OTEL collector</span>
              <strong>
                {otel.connections} connection{otel.connections === 1 ? "" : "s"}
                {otel.connectionHealth ? ` · ${stateLabel(otel.connectionHealth)}` : ""}
              </strong>
            </div>
            <div className="register-monitoring-row">
              <span>OTEL last signal</span>
              <strong data-testid="otel-last-signal">
                {otel.lastSignalAt ? new Date(otel.lastSignalAt).toLocaleString() : "None yet"}
              </strong>
            </div>
            <div className="register-monitoring-row">
              <span>OTEL signal counts</span>
              <strong data-testid="otel-signal-counts">
                metric {otel.signalCounts.metric} · log {otel.signalCounts.log} · span{" "}
                {otel.signalCounts.span + otel.signalCounts.trace} · total {otel.signalCounts.total}
              </strong>
            </div>
            <div className="register-monitoring-row">
              <span>OTEL discovered</span>
              <strong data-testid="otel-discovered">
                {otel.discoveredEntities} entities · {otel.discoveredRelationships} relationships
                {otel.staleEntities > 0 ? ` · ${otel.staleEntities} stale/Unknown` : ""}
              </strong>
            </div>
            <div className="register-monitoring-row">
              <span>Flag · Ingestion</span>
              <span data-testid="otel-flag-ingestion">
                <FlagState enabled={otel.ingestionEnabled} />
              </span>
            </div>
            <div className="register-monitoring-row">
              <span>Flag · Topology discovery</span>
              <span data-testid="otel-flag-topology">
                <FlagState enabled={otel.topologyDiscoveryEnabled} />
              </span>
            </div>
            <div className="register-monitoring-row">
              <span>Flag · Alert generation</span>
              <span data-testid="otel-flag-alerts">
                <FlagState enabled={otel.alertGenerationEnabled} />
              </span>
            </div>
            <div className="register-monitoring-row">
              <span>Flag · Incident correlation</span>
              <span data-testid="otel-flag-incidents">
                <FlagState enabled={otel.incidentCorrelationEnabled} />
              </span>
            </div>
            {otel.processingNotes?.length ? (
              <div className="dashboard-subtle" data-testid="otel-processing-notes">
                {otel.processingNotes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
