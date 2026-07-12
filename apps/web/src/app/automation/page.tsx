"use client";

import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";

const cards = [
  {
    title: "Playbooks",
    description: "Versioned remediation and response playbooks with approval workflow.",
    href: "/automation/playbooks"
  },
  {
    title: "Auto-Run Policy",
    description: "Govern when autonomous actions may execute without human approval.",
    href: "/auto-run-policy"
  },
  {
    title: "Accuracy & Actions",
    description: "Review automation accuracy, action outcomes, and operator overrides.",
    href: "/accuracy"
  },
  {
    title: "Checks",
    description: "Synthetic and heartbeat checks that feed automation triggers.",
    href: "/checks"
  }
];

export default function AutomationHubPage() {
  return (
    <Shell>
      <Header title="Automation" />
      <p className="dashboard-subtle">Central hub for playbooks, policies, and autonomous reliability controls.</p>
      <section className="automation-hub-grid">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="panel automation-hub-card">
            <h2>{card.title}</h2>
            <p>{card.description}</p>
          </Link>
        ))}
      </section>
    </Shell>
  );
}
