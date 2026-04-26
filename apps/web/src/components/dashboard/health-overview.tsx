import Link from "next/link";

export function HealthOverview({ healthy, degraded, down }: { healthy: number; degraded: number; down: number }) {
  return (
    <section className="panel">
      <h2>Health Overview</h2>
      <div className="pill-row">
        <Link className="pill healthy" href="/projects?health=HEALTHY">Healthy: {healthy}</Link>
        <Link className="pill degraded" href="/projects?health=DEGRADED">Degraded: {degraded}</Link>
        <Link className="pill down" href="/projects?health=DOWN">Down: {down}</Link>
      </div>
    </section>
  );
}
