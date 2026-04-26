import Link from "next/link";

export function RecentAlerts({
  items,
  loading = false
}: {
  items: Array<{
    id?: string;
    title: string;
    severity: string;
    status: string;
    projectName: string;
    serviceName: string | null;
    timestamp: string;
  }>;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section className="panel">
        <h2>Recent Alerts</h2>
        <p>Loading alerts...</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Recent Alerts</h2>
      {items.length === 0 ? (
        <p>
          No open alerts. <Link href="/alerts">View alert history</Link>.
        </p>
      ) : null}
      <ul className="dashboard-list">
        {items.map((item, idx) => (
          <li key={`${item.id ?? item.title}-${idx}`}>
            <div>
              <span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span>{" "}
              <strong>{item.id ? <Link href={`/alerts/${item.id}`}>{item.title}</Link> : item.title}</strong>
            </div>
            <div className="dashboard-subtle">
              {item.projectName}{item.serviceName ? ` / ${item.serviceName}` : ""} · {item.status} · {new Date(item.timestamp).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
