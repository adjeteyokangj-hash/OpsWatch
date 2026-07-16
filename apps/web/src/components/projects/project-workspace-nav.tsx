"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

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

export const projectNavStorageKey = (projectId: string): string =>
  `opswatch.projectNav.openSection:${projectId}`;

const normalizePath = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

const isProjectRootPath = (path: string): boolean => /^\/projects\/[^/]+$/.test(path);

export const isProjectNavLinkActive = (
  pathname: string,
  link: ProjectNavLink,
  hash: string
): boolean => {
  const currentPath = normalizePath(pathname);
  const targetPath = normalizePath(link.href.split("#")[0] ?? link.href);
  const targetHash = link.hash ?? "";
  const onTargetPath = isProjectRootPath(targetPath)
    ? currentPath === targetPath
    : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);

  if (!onTargetPath) return false;
  if (targetHash) return hash === targetHash;
  if (targetPath.endsWith("/insights") && hash === "#predictions") return false;
  if (targetPath.endsWith("/topology") && hash === "#incident-memory") return false;
  return true;
};

/** Prefer hash-specific matches so Incident Memory / Predictions open their section. */
export const findActiveProjectNavGroupLabel = (
  projectId: string,
  pathname: string,
  hash: string
): string | null => {
  const groups = buildProjectNavGroups(projectId);
  for (const group of groups) {
    for (const link of group.links) {
      if (link.hash && isProjectNavLinkActive(pathname, link, hash)) {
        return group.label;
      }
    }
  }
  for (const group of groups) {
    for (const link of group.links) {
      if (!link.hash && isProjectNavLinkActive(pathname, link, hash)) {
        return group.label;
      }
    }
  }
  return null;
};

const readStoredSection = (projectId: string, groups: ProjectNavGroup[]): string | null => {
  try {
    const stored = window.localStorage.getItem(projectNavStorageKey(projectId));
    if (stored && groups.some((group) => group.label === stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures (private mode / blocked).
  }
  return null;
};

const persistSection = (projectId: string, label: string) => {
  try {
    window.localStorage.setItem(projectNavStorageKey(projectId), label);
  } catch {
    // Ignore storage failures (private mode / blocked).
  }
};

export function ProjectWorkspaceNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const baseId = useId();
  const [hash, setHash] = useState("");
  const groups = buildProjectNavGroups(projectId);
  const [openSection, setOpenSection] = useState<string>(groups[0]?.label ?? "Core Operations");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  useEffect(() => {
    const active = findActiveProjectNavGroupLabel(projectId, pathname, hash);
    if (active) {
      setOpenSection(active);
      persistSection(projectId, active);
      return;
    }
    const stored = readStoredSection(projectId, groups);
    setOpenSection(stored ?? groups[0]?.label ?? "Core Operations");
    // groups is derived from projectId; omit to avoid identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on route/hash only
  }, [projectId, pathname, hash]);

  const openGroup = (label: string) => {
    setOpenSection(label);
    persistSection(projectId, label);
  };

  return (
    <nav className="project-workspace-nav-grouped" aria-label="Application workspace">
      {groups.map((group) => {
        const isOpen = openSection === group.label;
        const panelId = `${baseId}-${group.label.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <div
            className={isOpen ? "project-nav-group is-open" : "project-nav-group"}
            key={group.label}
          >
            <button
              type="button"
              className="project-nav-group-trigger"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => openGroup(group.label)}
            >
              <span className="project-nav-group-label">{group.label}</span>
              <span className="project-nav-group-chevron" aria-hidden="true">
                {isOpen ? "▾" : "▸"}
              </span>
            </button>
            <div
              className="project-nav-group-links"
              id={panelId}
              role="region"
              aria-label={group.label}
              hidden={!isOpen}
            >
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
        );
      })}
    </nav>
  );
}
