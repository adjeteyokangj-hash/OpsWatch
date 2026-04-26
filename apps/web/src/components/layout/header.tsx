"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearAuthCookie } from "../../lib/auth";

export function Header({ title, actions }: { title: string; actions?: ReactNode }) {
  const router = useRouter();

  const handleLogout = () => {
    clearAuthCookie();
    router.replace("/login");
  };

  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1>{title}</h1>
        <p>OpsWatch command center</p>
      </div>
      <div className="page-header-actions">
        {actions}
        <button type="button" className="secondary-button" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
