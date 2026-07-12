import Link from "next/link";
import { SeverityBadge } from "../alerts/severity-badge";

type AlertRow = {
  id: string;
  title: string;
  severity?: string;
  status: string;
  lastSeenAt: string;
};

type IncidentRow = {
  id: string;
  title: string;
  severity?: string;
  status: string;
  openedAt: string;
};

export function ProjectActivityFeed({
  title,
  emptyMessage,
  emptyHref,
  emptyHrefLabel,
  alerts,
  incidents
}: {
  title: string;
  emptyMessage: string;
  emptyHref?: string;
  emptyHrefLabel?: string;
  alerts?: AlertRow[];
  incidents?: IncidentRow[];
}) {
  const hasAlerts = (alerts?.length ?? 0) > 0;
  const hasIncidents = (incidents?.length ?? 0) > 0;

  if (!hasAlerts && !hasIncidents) {
    return (
      <section className="panel workspace-empty-state">
        <h2>{title}</h2>
        <p>{emptyMessage}</p>
        {emptyHref && emptyHrefLabel ? (
          <Link className="secondary-button" href={emptyHref}>
            {emptyHrefLabel}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="activity-feed">
        {alerts?.map((alert) => (
          <article className="activity-feed-item" key={`alert-${alert.id}`}>
            <div className="activity-feed-head">
              <SeverityBadge severity={alert.severity ?? "LOW"} />
              <span className={`result-pill ${alert.status === "ACKNOWLEDGED" ? "warn" : "fail"}`}>{alert.status}</span>
            </div>
            <Link className="activity-feed-title" href={`/alerts/${alert.id}`}>
              {alert.title}
            </Link>
            <p className="activity-feed-meta">Last seen {new Date(alert.lastSeenAt).toLocaleString()}</p>
          </article>
        ))}
        {incidents?.map((incident) => (
          <article className="activity-feed-item" key={`incident-${incident.id}`}>
            <div className="activity-feed-head">
              <span className={`incident-chip ${incident.status === "RESOLVED" ? "resolved" : "active"}`}>{incident.status}</span>
              {incident.severity ? <SeverityBadge severity={incident.severity} /> : null}
            </div>
            <Link className="activity-feed-title" href={`/incidents/${incident.id}`}>
              {incident.title}
            </Link>
            <p className="activity-feed-meta">Opened {new Date(incident.openedAt).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
