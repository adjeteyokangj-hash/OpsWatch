"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navGroups = [
  {
    label: "Overview",
    links: [["Dashboard", "/dashboard"]] as const
  },
  {
    label: "Operations",
    links: [
      ["Projects", "/projects"],
      ["Apps", "/apps"],
      ["Incidents", "/incidents"],
      ["Alerts", "/alerts"]
    ] as const
  },
  {
    label: "Platform",
    links: [
      ["Workflows", "/workflows"],
      ["Services", "/services"],
      ["Automation", "/automation"],
      ["Security", "/security"],
      ["Maintenance", "/maintenance"]
    ] as const
  },
  {
    label: "Admin",
    links: [
      ["Reports", "/reports"],
      ["Members", "/members"],
      ["Settings", "/settings"]
    ] as const
  }
] as const;

const navIcons: Record<string, string> = {
  Dashboard: "⌂",
  Projects: "▣",
  Apps: "▦",
  Incidents: "◆",
  Alerts: "!",
  Workflows: "↻",
  Services: "◎",
  Automation: "⚙",
  Security: "⛨",
  Maintenance: "⏸",
  Reports: "▤",
  Members: "⊕",
  Settings: "≡"
};

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <img src="/brand/opswatch-icon.png" alt="OpsWatch" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">
            Ops<span className="sidebar-brand-accent">Watch</span>
          </span>
          <span className="sidebar-brand-sub">Command Center</span>
        </div>
      </div>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        <span>Menu</span>
        <span aria-hidden="true">{open ? "×" : "☰"}</span>
      </button>
      <nav id="primary-navigation" className={open ? "mobile-nav-open" : ""}>
        {navGroups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <span className="sidebar-group-label">{group.label}</span>
            {group.links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={pathname.startsWith(href) ? "active" : ""}
              >
                <span className="nav-icon" aria-hidden="true">
                  {navIcons[label]}
                </span>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
