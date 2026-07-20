import Link from "next/link";
import { SeverityBadge } from "../alerts/severity-badge";
import { ActivityList } from "../ui/activity-list";
import { EmptyState } from "../ui/empty-state";
import { PageSection } from "../ui/page-section";

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
      <PageSection
        title="Recent incidents"
        description="Active incidents requiring operator attention."
        persistKey="org:dashboard:recent-incidents"
      >
        <p>Loading incidents…</p>
      </PageSection>
    );
  }

  return (
    <PageSection
      title="Recent incidents"
      description="Active incidents requiring operator attention."
      persistKey="org:dashboard:recent-incidents"
    >
      {items.length === 0 ? (
        <EmptyState
          title="No active incidents"
          description="No unresolved incidents are open right now."
          action={
            <Link className="secondary-button" href="/incidents">
              View incident history
            </Link>
          }
        />
      ) : (
        <ActivityList
          items={items.map((item, idx) => ({
            id: `${item.id ?? item.title}-${idx}`,
            href: item.id ? `/incidents/${item.id}` : undefined,
            title: item.title,
            badges: (
              <>
                <span className={`incident-chip ${item.status === "RESOLVED" ? "resolved" : "active"}`}>{item.status}</span>
                <SeverityBadge severity={item.severity} />
              </>
            ),
            meta: `${item.projectName} · Opened ${new Date(item.openedAt).toLocaleString()}`
          }))}
        />
      )}
      {resolvedCount > 0 ? (
        <p className="dashboard-subtle workspace-footnote">Resolved incidents are hidden from this primary panel ({resolvedCount}).</p>
      ) : null}
    </PageSection>
  );
}
