"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type ProjectNavLink = {
  label: string;
  href: string;
  hash?: string;
};

export type ProjectNavGroup = {
  label: string;
  links: ProjectNavLink[];
};

/** Grouped application workspace navigation — presentation only; routes stay stable. */
export const buildProjectNavGroups = (projectId: string): ProjectNavGroup[] => [
  {
    label: "Core Operations",
    links: [
      { label: "Overview", href: `/projects/${projectId}` },
      { label: "Topology", href: `/projects/${projectId}/topology` },
      { label: "Modules", href: `/projects/${projectId}/modules` },
      { label: "Components", href: `/projects/${projectId}/components` },
      { label: "Workflows", href: `/projects/${projectId}/workflows` }
    ]
  },
  {
    label: "Reliability",
    links: [
      { label: "Checks", href: `/projects/${projectId}/checks` },
      { label: "Alerts", href: `/projects/${projectId}/alerts` },
      { label: "Incidents", href: `/projects/${projectId}/incidents` },
      { label: "Dependencies & SLOs", href: `/projects/${projectId}/reliability` }
    ]
  },
  {
    label: "Automation & Intelligence",
    links: [
      { label: "Automation", href: `/projects/${projectId}/automation` },
      { label: "Intelligence", href: `/projects/${projectId}/insights` },
      { label: "Predictions", href: `/projects/${projectId}/insights`, hash: "#predictions" },
      { label: "Incident Memory", href: `/projects/${projectId}/topology`, hash: "#incident-memory" }
    ]
  },
  {
    label: "Administration",
    links: [
      { label: "Integrations", href: `/integrations/${projectId}` },
      { label: "Policies", href: `/projects/${projectId}/policies` },
      { label: "Contacts", href: `/projects/${projectId}/contacts` },
      { label: "Billing", href: `/projects/${projectId}/billing` },
      { label: "Configuration", href: `/projects/${projectId}/settings` }
    ]
  }
];

const normalizePath = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

export const isProjectNavLinkActive = (
  pathname: string,
  link: ProjectNavLink,
  hash: string
): boolean => {
  const currentPath = normalizePath(pathname);
  const targetPath = normalizePath(link.href.split("#")[0] ?? link.href);
  const targetHash = link.hash ?? "";
  const onTargetPath = currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);

  if (!onTargetPath) return false;
  if (targetHash) return hash === targetHash;
  if (targetPath.endsWith("/insights") && hash === "#predictions") return false;
  if (targetPath.endsWith("/topology") && hash === "#incident-memory") return false;
  return true;
};

export function ProjectWorkspaceNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  const groups = buildProjectNavGroups(projectId);

  return (
    <nav className="project-workspace-nav-grouped" aria-label="Application workspace">
      {groups.map((group) => (
        <div className="project-nav-group" key={group.label}>
          <span className="project-nav-group-label">{group.label}</span>
          <div className="project-nav-group-links">
            {group.links.map((link) => {
              const active = isProjectNavLinkActive(pathname, link, hash);
              const href = link.hash ? `${link.href}${link.hash}` : link.href;
              return (
                <Link
                  key={`${group.label}-${link.label}`}
                  className={active ? "pill active" : "pill"}
                  href={href}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
