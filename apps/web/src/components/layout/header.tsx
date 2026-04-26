"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearAuthCookie, getAuthToken } from "../../lib/auth";
import { API_BASE_URL } from "../../lib/constants";

export function Header({ title, actions }: { title: string; actions?: ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    const token = getAuthToken();

    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: "no-store"
      });
    } catch {
      // Ignore network failures; local sign-out still clears client auth state.
    } finally {
      clearAuthCookie();
      router.replace("/login");
    }
  };

  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1>{title}</h1>
        <p>OpsWatch command center</p>
      </div>
      <div className="page-header-actions">
        {actions}
        <button type="button" className="secondary-button" onClick={handleLogout} data-action="api" data-endpoint="/auth/logout">
          Logout
        </button>
      </div>
    </header>
  );
}
