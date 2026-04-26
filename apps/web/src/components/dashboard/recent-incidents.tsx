import Link from "next/link";

export function RecentIncidents({
  items,
  resolvedCount = 0,
  loading = false
}: {
  items: Array<{
    id?: string;
    title: string;
    status: string;
    severity: string;
    projectName: string;
    openedAt: string;
  }>;
  resolvedCount?: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section className="panel">
        <h2>Recent Incidents</h2>
        <p>Loading incidents...</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Recent Incidents</h2>
      {items.length === 0 ? (
        <p>
          No active incidents. <Link href="/incidents">View incident history</Link>.
        </p>
      ) : null}
      <ul className="dashboard-list">
        {items.map((item, idx) => (
          <li key={`${item.id ?? item.title}-${idx}`}>
            <div>
              <span className={`incident-chip ${item.status === "RESOLVED" ? "resolved" : "active"}`}>{item.status}</span>{" "}
              <strong>{item.id ? <Link href={`/incidents/${item.id}`}>{item.title}</Link> : item.title}</strong>
            </div>
            <div className="dashboard-subtle">
              {item.severity} · {item.projectName} · Opened {new Date(item.openedAt).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
      {resolvedCount > 0 ? <p className="dashboard-subtle">Resolved incidents are hidden from this primary panel ({resolvedCount}).</p> : null}
    </section>
  );
}
