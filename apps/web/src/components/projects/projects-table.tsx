import Link from "next/link";

const healthClass = (status: string) => {
  if (status === "HEALTHY") return "pass";
  if (status === "DOWN") return "fail";
  return "warn";
};

const healthToneClass = (status: string) => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DOWN") return "down";
  return "degraded";
};

const projectReason = (row: any) => {
  const openAlerts = row.alerts || [];
  const unresolvedIncidents = (row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED");
  if (openAlerts.length > 0) {
    const first = openAlerts[0];
    const extra = openAlerts.length > 1 ? ` + ${openAlerts.length - 1} more` : "";
    return `${first.title || "Open alert"}${extra}`;
  }
  if (unresolvedIncidents.length > 0) {
    const first = unresolvedIncidents[0];
    const extra = unresolvedIncidents.length > 1 ? ` + ${unresolvedIncidents.length - 1} more` : "";
    return `${first.title || "Active incident"}${extra}`;
  }
  if (row.status === "DEGRADED") return "Project status is still marked degraded";
  return "-";
};

const heartbeatLabel = (row: any): string => {
  const latest = row.heartbeats?.[0]?.receivedAt;
  if (!latest) return "No heartbeat";
  const ageMs = Date.now() - new Date(latest).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 2) return "Just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours} h ago`;
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays} d ago`;
};

const issueSummary = (row: any): string => {
  if (row.status === "DOWN") {
    return "Service down";
  }

  if (row.status === "DEGRADED") {
    const extraIssues = Math.max((row.alerts?.length || 0) - 1, 0);
    if (extraIssues > 0) {
      return `Heartbeat stale (+${extraIssues} issue${extraIssues === 1 ? "" : "s"})`;
    }
    return "Heartbeat stale";
  }

  return projectReason(row);
};

export function ProjectsTable({ rows }: { rows: Array<any> }) {
  return (
    <table className="data-table projects-table">
      <thead>
        <tr>
          <th>Project</th>
          <th>Client</th>
          <th>Env</th>
          <th>Health</th>
          <th>Reason</th>
          <th>Services</th>
          <th>Last Heartbeat</th>
          <th>Open Alerts</th>
          <th>Unresolved Incidents</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link href={`/projects/${row.id}`}>{row.name}</Link>
            </td>
            <td>{row.clientName}</td>
            <td>{row.environment}</td>
            <td>
              <Link href={`/alerts?projectId=${row.id}&status=OPEN`} className={`result-pill ${healthClass(row.status)} pill ${healthToneClass(row.status)}`}>
                {row.status}
              </Link>
            </td>
            <td>
              {row.status !== "HEALTHY" ? <span className="needs-attention">Needs attention</span> : null}
              {row.status !== "HEALTHY" ? " " : null}
              <span className={`issue-text${row.status === "DOWN" ? " critical" : ""}`}>
                {issueSummary(row)}
              </span>
            </td>
            <td>{row.services?.length || 0}</td>
            <td>
              {row.heartbeats?.[0]?.receivedAt ? (
                <Link href={`/projects/${row.id}/activity`}>
                  {heartbeatLabel(row)}
                </Link>
              ) : (
                <Link href={`/projects/${row.id}/activity`}>No heartbeat</Link>
              )}
            </td>
            <td>
              <Link
                href={`/alerts?projectId=${row.id}&status=OPEN`}
                className={
                  (row.alerts?.length || 0) === 0
                    ? undefined
                    : row.status === "DOWN"
                      ? "alert-count-critical"
                      : "alert-count-warning"
                }
              >
                {row.alerts?.length || 0}
              </Link>
            </td>
            <td>
              <Link href={`/incidents?projectId=${row.id}&onlyUnresolved=true`}>
                {(row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
