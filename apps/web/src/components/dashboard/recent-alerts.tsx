import Link from "next/link";
import { SeverityBadge } from "../alerts/severity-badge";
import { ActivityList } from "../ui/activity-list";
import { EmptyState } from "../ui/empty-state";
import { PageSection } from "../ui/page-section";

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
      <PageSection title="Recent alerts" description="Latest open signals across your estate.">
        <p>Loading alerts…</p>
      </PageSection>
    );
  }

  return (
    <PageSection title="Recent alerts" description="Latest open signals across your estate.">
      {items.length === 0 ? (
        <EmptyState
          title="No open alerts"
          description="Monitoring is quiet right now."
          action={
            <Link className="secondary-button" href="/alerts">
              View alert history
            </Link>
          }
        />
      ) : (
        <ActivityList
          items={items.map((item, idx) => ({
            id: `${item.id ?? item.title}-${idx}`,
            href: item.id ? `/alerts/${item.id}` : undefined,
            title: item.title,
            badges: (
              <>
                <SeverityBadge severity={item.severity} />
                <span className={`result-pill ${item.status === "ACKNOWLEDGED" ? "warn" : "fail"}`}>{item.status}</span>
              </>
            ),
            meta: `${item.projectName}${item.serviceName ? ` / ${item.serviceName}` : ""} · ${new Date(item.timestamp).toLocaleString()}`
          }))}
        />
      )}
    </PageSection>
  );
}
