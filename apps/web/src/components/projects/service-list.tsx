import Link from "next/link";

const statusClass = (status: string) => {
  if (status === "HEALTHY") return "pass";
  if (status === "DOWN") return "fail";
  return "warn";
};

export function ServiceList({ rows, projectId }: { rows: Array<any>; projectId?: string }) {
  if (rows.length === 0) {
    return <p>No services configured. Add a service to begin check coverage.</p>;
  }

  return (
    <ul className="service-list">
      {rows.map((row) => (
        <li key={row.id}>
          <strong>{row.name}</strong> ({row.type}) {" "}
          <span className={`result-pill ${statusClass(row.status)}`}>{row.status}</span>
          {row.isCritical ? <span className="dashboard-subtle"> critical</span> : null}
          {projectId ? (
            <span className="dashboard-subtle"> · <Link href={`/checks?projectId=${projectId}&serviceId=${row.id}`}>view checks</Link></span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
