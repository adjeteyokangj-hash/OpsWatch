import Link from "next/link";

const cards = [
  {
    title: "Auto-run policy",
    description: "Autonomous action boundaries and approval thresholds for this estate.",
    href: "/auto-run-policy",
    icon: "⚡"
  },
  {
    title: "Project settings",
    description: "Monitoring, automation mode, and application configuration.",
    buildHref: (projectId: string) => `/projects/${projectId}/settings`,
    icon: "⚙"
  },
  {
    title: "Billing & plan limits",
    description: "Plan tier, monthly price, and usage allowances for this project.",
    buildHref: (projectId: string) => `/projects/${projectId}/billing`,
    icon: "£"
  }
] as const;

export function PolicyLinkCards({ projectId }: { projectId: string }) {
  return (
    <section className="hub-card-grid">
      {cards.map((card) => {
        const href = "buildHref" in card ? card.buildHref(projectId) : card.href;
        return (
          <Link key={href} href={href} className="hub-card">
            <span className="hub-card-icon" aria-hidden="true">
              {card.icon}
            </span>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
            <span className="hub-card-link">Open →</span>
          </Link>
        );
      })}
    </section>
  );
}
