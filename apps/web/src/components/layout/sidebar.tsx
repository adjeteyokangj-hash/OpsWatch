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
      <div className="brand">OpsWatch</div>
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
