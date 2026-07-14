"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Application workspace tabs — Overview through Settings. */
const tabs = [
  ["Overview", ""],
  ["Topology", "/topology"],
  ["Modules", "/modules"],
  ["Workflows", "/workflows"],
  ["Services", "/services"],
  ["Incidents", "/incidents"],
  ["Alerts", "/alerts"],
  ["Deployments", "/deployments"],
  ["Automation", "/automation"],
  ["Metrics", "/metrics"],
  ["Logs", "/log-streams"],
  ["AI Insights", "/insights"],
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
        const href = `${base}${path}`;
        const active =
          path === ""
            ? pathname === base || pathname === `${base}/`
            : pathname === href || pathname.startsWith(`${href}/`);
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
