"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { refreshAuthSession } from "../../lib/auth";

/**
 * Authenticated app chrome. Middleware already enforced the session cookie;
 * do not gate page content on a client /auth/session probe — hung session
 * fetches previously left mobile (and desktop) stuck on “Loading workspace…”.
 */
export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Warm the short-lived session cache for Sidebar / pages that need role or
    // org claims. Timeout + coalescing live in refreshAuthSession.
    void refreshAuthSession();
  }, []);

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="content-inner">{children}</div>
      </main>
    </div>
  );
}
