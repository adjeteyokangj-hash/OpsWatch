import Link from "next/link";
import { PageSection } from "../ui/page-section";

export function HealthOverview({ healthy, degraded, down }: { healthy: number; degraded: number; down: number }) {
  return (
    <PageSection
      title="Health overview"
      description="Project health distribution across the estate."
      persistKey="org:dashboard:health-overview"
    >
      <div className="health-pill-grid">
        <Link className="health-pill-card healthy" href="/projects?health=HEALTHY">
          <span className="health-pill-label">Healthy</span>
          <strong>{healthy}</strong>
        </Link>
        <Link className="health-pill-card degraded" href="/projects?health=DEGRADED">
          <span className="health-pill-label">Degraded</span>
          <strong>{degraded}</strong>
        </Link>
        <Link className="health-pill-card down" href="/projects?health=DOWN">
          <span className="health-pill-label">Down</span>
          <strong>{down}</strong>
        </Link>
      </div>
    </PageSection>
  );
}
