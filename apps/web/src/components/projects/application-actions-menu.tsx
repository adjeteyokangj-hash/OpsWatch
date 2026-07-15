"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type Props = {
  projectId: string;
  applicationName: string;
  /** When true, Overview is already a primary button — omit from menu. */
  omitOverview?: boolean;
  /** When true, Topology is already a primary button — omit from menu. */
  omitTopology?: boolean;
};

const destinations = (projectId: string) =>
  [
    { href: `/projects/${projectId}`, label: "Overview", key: "overview" as const },
    { href: `/projects/${projectId}/topology`, label: "Topology", key: "topology" as const },
    { href: `/projects/${projectId}/incidents`, label: "Incidents", key: "incidents" as const },
    { href: `/projects/${projectId}/alerts`, label: "Alerts", key: "alerts" as const },
    { href: `/projects/${projectId}/automation`, label: "Automation", key: "automation" as const },
    { href: `/projects/${projectId}/insights`, label: "Intelligence", key: "intelligence" as const },
    { href: `/projects/${projectId}/settings`, label: "Configuration", key: "configuration" as const }
  ] as const;

export function ApplicationActionsMenu({
  projectId,
  applicationName,
  omitOverview = false,
  omitTopology = false
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items = destinations(projectId).filter((item) => {
    if (omitOverview && item.key === "overview") return false;
    if (omitTopology && item.key === "topology") return false;
    return true;
  });

  return (
    <div className="application-actions-menu" ref={rootRef}>
      <button
        type="button"
        className="secondary-button application-actions-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`More actions for ${applicationName}`}
        onClick={() => setOpen((value) => !value)}
      >
        ···
      </button>
      {open ? (
        <ul id={menuId} className="application-actions-menu-list" role="menu">
          {items.map((item) => (
            <li key={item.href} role="none">
              <Link role="menuitem" href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
