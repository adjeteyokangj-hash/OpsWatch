"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchSessionUser, type SessionUser } from "../../lib/auth";

const baseNavGroups = [
  {
    label: "Overview",
    links: [
      ["Dashboard", "/dashboard"],
      ["Intelligence", "/intelligence"]
    ] as const
  },
  {
    label: "Operations",
    links: [
      ["Applications", "/projects"],
      ["Incidents", "/incidents"],
      ["Alerts", "/alerts"]
    ] as const
  },
  {
    label: "Platform",
    links: [
      ["Connections", "/connections"],
      ["Integrations", "/integrations"],
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
      ["Subscription", "/subscription"],
      ["Settings", "/settings"]
    ] as const
  }
] as const;

const platformAdminGroup = {
  label: "Platform Administration",
  links: [
    ["Subscription Plans", "/subscription"],
    ["Stripe", "/admin/billing/stripe"]
  ] as const
};

const navIcons: Record<string, string> = {
  Dashboard: "⌂",
  Intelligence: "◉",
  Applications: "▣",
  Incidents: "◆",
  Alerts: "!",
  Connections: "⌁",
  Integrations: "⇄",
  Workflows: "↻",
  Services: "◎",
  Automation: "⚙",
  Security: "⛨",
  Maintenance: "⏸",
  Reports: "▤",
  Members: "⊕",
  Subscription: "$",
  "Subscription Plans": "$",
  Settings: "≡",
  Stripe: "◈"
};

const SIDEBAR_COLLAPSED_KEY = "opswatch.sidebar-collapsed";

function readCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setCollapsed(readCollapsedPreference());
  }, []);

  useEffect(() => {
    void fetchSessionUser().then(setSessionUser);
  }, []);

  const groups = useMemo(() => {
    const isOrgAdmin = sessionUser?.role === "ADMIN";
    const showPlatformAdminNav = isOrgAdmin || sessionUser?.isPlatformSuperAdmin === true;

    if (!showPlatformAdminNav) {
      return baseNavGroups;
    }

    const adminWithoutSubscription = baseNavGroups.map((group) =>
      group.label === "Admin"
        ? {
            ...group,
            links: group.links.filter(([label]) => label !== "Subscription")
          }
        : group
    );

    return [...adminWithoutSubscription, platformAdminGroup];
  }, [sessionUser?.role, sessionUser?.isPlatformSuperAdmin]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures (private mode, quota, etc.).
      }
      return next;
    });
  };

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <Image src="/brand/opswatch-icon.png" alt="OpsWatch" width={24} height={24} priority />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">
            Ops<span className="sidebar-brand-accent">Watch</span>
          </span>
          <span className="sidebar-brand-sub">Command Center</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
        </button>
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
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <span className="sidebar-group-label">{group.label}</span>
            {group.links.map(([label, href]) => (
              <Link
                key={`${group.label}-${label}`}
                href={href}
                title={label}
                onClick={() => setOpen(false)}
                className={pathname.startsWith(href) ? "active" : ""}
              >
                <span className="nav-icon" aria-hidden="true">
                  {navIcons[label]}
                </span>
                <span className="nav-label">{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
