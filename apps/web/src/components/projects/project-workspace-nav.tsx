"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Application workspace tabs (mission set).
 * Routes kept stable: Components=/components (Services redirects),
 * Intelligence=/insights, Configuration=/settings.
 * Metrics, Logs, Deployments remain reachable from Configuration.
 */
const tabs = [
  ["Overview", ""],
  ["Modules", "/modules"],
  ["Workflows", "/workflows"],
  ["Components", "/components"],
  ["Topology", "/topology"],
  ["Incidents", "/incidents"],
  ["Alerts", "/alerts"],
  ["Automation", "/automation"],
  ["Intelligence", "/insights"],
  ["Configuration", "/settings"]
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
    <nav ref={navRef} className="pill-row project-workspace-nav" aria-label="Application workspace">
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
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
