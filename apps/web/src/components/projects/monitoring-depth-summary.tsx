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
      heartbeat: "CONNECTED" | "AWAITING_SETUP";
      events: "CONNECTED" | "NOT_CONFIGURED";
    };
    advancedMonitoring: {
      logs: "NOT_CONNECTED";
      traces: "NOT_CONNECTED";
      infrastructure: "NOT_CONNECTED";
    };
  };
};

const stateLabel = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());

const BoolState = ({ active, activeLabel, inactiveLabel }: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) => <strong className={active ? "success-text" : "dashboard-subtle"}>{active ? activeLabel : inactiveLabel}</strong>;

export function MonitoringDepthSummary({
  setup,
  onRetry,
  retrying = false
}: {
  setup: MonitoringSetup;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="monitoring-depth-summary" data-testid="monitoring-depth-summary">
      <div className="panel-heading-row">
        <div>
          <h3>Monitoring depth</h3>
          <p className="dashboard-subtle">External checks do not imply internal application visibility.</p>
        </div>
        <span className={`status-badge status-${setup.status === "ACTIVE" ? "healthy" : setup.status === "FAILED" ? "down" : "unknown"}`}>
          {stateLabel(setup.status)}
        </span>
      </div>

      {setup.status === "SETTING_UP" ? (
        <ul className="register-wizard-checklist">
          <li className={setup.steps.websiteConnectionCreated ? "done" : "pending"}>Website connection created</li>
          <li className={setup.steps.httpCheckScheduled ? "done" : "pending"}>HTTP check scheduled</li>
          <li className={setup.steps.sslCheckScheduled ? "done" : "pending"}>SSL check scheduled</li>
          <li className={setup.steps.firstCheckPending ? "pending" : setup.steps.monitoringActive ? "done" : ""}>
            {setup.steps.monitoringActive ? "Monitoring active" : "First check pending"}
          </li>
        </ul>
      ) : null}

      {setup.status === "FAILED" ? (
        <div className="error-panel" role="alert">
          <strong>Monitoring setup failed</strong>
          <p>{setup.error || "The monitoring worker could not complete setup."}</p>
          {onRetry ? (
            <button type="button" className="secondary-button" onClick={onRetry} disabled={retrying} data-action="api">
              {retrying ? "Retrying…" : "Retry setup"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="register-monitoring-preview">
        <div className="register-monitoring-row">
          <span>External · Public URL</span>
          <BoolState active={setup.depth.externalMonitoring.publicUrlConnected} activeLabel="Connected" inactiveLabel="Not configured" />
        </div>
        <div className="register-monitoring-row">
          <span>External · HTTP</span>
          <BoolState active={setup.depth.externalMonitoring.httpMonitoringActive} activeLabel="Active" inactiveLabel="Pending / not configured" />
        </div>
        <div className="register-monitoring-row">
          <span>External · SSL</span>
          <BoolState active={setup.depth.externalMonitoring.sslMonitoringActive} activeLabel="Active" inactiveLabel="Pending / not configured" />
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
          <span>Advanced · Logs</span>
          <strong>Not connected</strong>
        </div>
        <div className="register-monitoring-row">
          <span>Advanced · Traces</span>
          <strong>Not connected</strong>
        </div>
        <div className="register-monitoring-row">
          <span>Advanced · Infrastructure</span>
          <strong>Not connected</strong>
        </div>
      </div>
    </div>
  );
}
