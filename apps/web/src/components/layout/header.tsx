"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearAuthCookies, getCsrfToken } from "../../lib/auth";
import { API_BASE_URL } from "../../lib/constants";

const pageDescriptions: Record<string, string> = {
  Dashboard: "A live view of system health, risk, and operator priorities.",
  Projects: "Monitor every application, service, and customer environment.",
  Alerts: "Triage active signals and focus on what needs attention now.",
  Incidents: "Coordinate investigation, impact, recovery, and resolution.",
  Checks: "Manage uptime, performance, keyword, SSL, and heartbeat checks.",
  "Remediation Accuracy": "Measure automation confidence and improve operational decisions.",
  "Auto-Run Policy": "Control which safe actions OpsWatch may execute automatically.",
  Settings: "Configure notification channels and external provider connections.",
  Status: "Understand current service availability and recent incidents.",
  Insights: "Turn monitoring gaps and correlations into actionable improvements.",
  Members: "Manage OpsWatch login accounts, roles, and organization membership.",
  Billing: "Review plan limits, usage, and subscription options.",
  Organization: "Manage organization identity, API access, and public status pages.",
  Onboarding: "Complete the steps required for reliable production monitoring."
};

export function Header({ title, actions }: { title: string; actions?: ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    const csrfToken = getCsrfToken();

    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "x-opswatch-csrf": csrfToken } : undefined,
        cache: "no-store"
      });
    } catch {
      // Ignore network failures; local sign-out still clears client auth state.
    } finally {
      clearAuthCookies();
      router.replace("/login");
    }
  };

  return (
    <header className="page-header platform-header">
      <div className="page-header-main">
        <span className="page-eyebrow">Operations workspace</span>
        <h1>{title}</h1>
        <p>{pageDescriptions[title] || "Monitor, investigate, and improve application reliability."}</p>
      </div>
      <div className="page-header-actions">
        {actions}
        <button type="button" className="secondary-button header-logout" onClick={handleLogout} data-action="api" data-endpoint="/auth/logout">
          Logout
        </button>
      </div>
    </header>
  );
}
