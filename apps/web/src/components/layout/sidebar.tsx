"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Dashboard", "/dashboard"],
  ["Projects", "/projects"],
  ["Alerts", "/alerts"],
  ["Incidents", "/incidents"],
  ["Checks", "/checks"],
  ["Accuracy", "/accuracy"],
  ["Auto-Run Policy", "/auto-run-policy"],
  ["Settings", "/settings"],
  ["Status", "/status"],
  ["Insights", "/insights"],
  ["Team", "/users"],
  ["Billing", "/billing"],
  ["Organization", "/org"],
  ["Onboarding", "/onboarding"]
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <img src="/brand/opswatch-icon.png" alt="OpsWatch" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">Ops<span className="sidebar-brand-accent">Watch</span></span>
          <span className="sidebar-brand-sub">Command Center</span>
        </div>
      </div>
      <nav>
        {links.map(([label, href]) => (
          <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
