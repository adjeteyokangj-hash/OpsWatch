"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const tabs = [
  ["Overview", ""],
  ["Monitored Areas", "/monitored-areas"],
  ["Service Map", "/topology"],
  ["Modules", "/modules"],
  ["Workflows", "/workflows"],
  ["Components", "/components"],
  ["Checks", "/checks"],
  ["Dependencies & SLOs", "/reliability"],
  ["Alerts", "/alerts"],
  ["Incidents", "/incidents"],
  ["Automation", "/automation"],
  ["Integrations", "/integrations"],
  ["Policies", "/policies"],
  ["Contacts", "/contacts"],
  ["Billing", "/billing"],
  ["Settings", "/settings"]
] as const;

export function ProjectWorkspaceNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    const activeTab = activeRef.current;
    if (!nav || !activeTab) return;

    const navBox = nav.getBoundingClientRect();
    const tabBox = activeTab.getBoundingClientRect();
    const offset = tabBox.left - navBox.left - navBox.width / 2 + tabBox.width / 2;
    nav.scrollTo({ left: nav.scrollLeft + offset, behavior: "smooth" });
  }, [pathname]);

  return (
    <nav ref={navRef} className="pill-row project-workspace-nav" aria-label="Project workspace">
      {tabs.map(([label, path]) => {
        const href = path.startsWith("/alerts")
          ? `/alerts?projectId=${projectId}`
          : path.startsWith("/incidents")
            ? `/incidents?projectId=${projectId}`
            : path === "/integrations"
              ? `/integrations/${projectId}`
              : `${base}${path}`;
        const active =
          path === ""
            ? pathname === base || pathname === `${base}/`
            : path === "/alerts"
              ? pathname.startsWith("/alerts")
              : path === "/incidents"
                ? pathname.startsWith("/incidents")
                : path === "/integrations"
                  ? pathname.startsWith(`/integrations/${projectId}`)
                  : pathname.startsWith(`${base}${path}`);
        return (
          <Link
            key={label}
            ref={active ? activeRef : undefined}
            className={active ? "pill active" : "pill"}
            href={href}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
