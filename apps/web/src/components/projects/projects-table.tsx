import Link from "next/link";

const healthClass = (status: string) => {
  if (status === "HEALTHY") return "pass";
  if (status === "DOWN") return "fail";
  return "warn";
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

export function ProjectsTable({ rows }: { rows: Array<any> }) {
  return (
    <table className="data-table">
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
              <Link href={`/alerts?projectId=${row.id}&status=OPEN`} className={`result-pill ${healthClass(row.status)}`}>
                {row.status}
              </Link>
            </td>
            <td>{projectReason(row)}</td>
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
              <Link href={`/alerts?projectId=${row.id}&status=OPEN`}>{row.alerts?.length || 0}</Link>
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
