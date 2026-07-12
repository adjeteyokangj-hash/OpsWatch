import Link from "next/link";

const policyRules = [
  {
    id: "cpu",
    title: "High CPU usage",
    description: "Alert when CPU exceeds 80% for 5 minutes on any critical component.",
    status: "Active",
    href: "/auto-run-policy"
  },
  {
    id: "latency",
    title: "Latency threshold",
    description: "Warn when p95 response time exceeds 500ms on API services.",
    status: "Active",
    href: "/auto-run-policy"
  },
  {
    id: "error-rate",
    title: "Error rate spike",
    description: "Open an incident when error rate exceeds 2% across workflows.",
    status: "Draft",
    href: "/auto-run-policy"
  }
] as const;

export function PolicyRuleCards({ projectId }: { projectId: string }) {
  return (
    <section className="policy-rule-grid">
      {policyRules.map((rule) => (
        <article className="policy-rule-card" key={rule.id}>
          <div className="policy-rule-head">
            <h3>{rule.title}</h3>
            <span className={`policy-rule-status ${rule.status === "Active" ? "active" : "draft"}`}>{rule.status}</span>
          </div>
          <p>{rule.description}</p>
          <div className="policy-rule-foot">
            <span className="dashboard-subtle">Project {projectId.slice(0, 8)}…</span>
            <Link href={rule.href} className="text-link">
              Configure
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
