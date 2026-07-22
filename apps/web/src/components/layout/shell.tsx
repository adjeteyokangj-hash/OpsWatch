"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { LogoutButton } from "../auth/logout-button";
import { hasSessionCookie, refreshAuthSession } from "../../lib/auth";

const isPublicShellRoute = (pathname: string): boolean =>
  pathname === "/status" || pathname.startsWith("/status-page/");

/**
 * Authenticated app chrome. Middleware already enforced the session cookie;
 * do not gate page content on a client /auth/session probe — hung session
 * fetches previously left mobile (and desktop) stuck on “Loading workspace…”.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sessionDegraded, setSessionDegraded] = useState(false);

  const warmSession = (force = false) => {
    setSessionDegraded(false);
    void refreshAuthSession({ force }).then((user) => {
      // Cookie present but probe timed out / failed — keep the page usable.
      if (!user && hasSessionCookie()) {
        setSessionDegraded(true);
      }
    });
  };

  useEffect(() => {
    // Warm the short-lived session cache for Sidebar / pages that need role or
    // org claims. Timeout + coalescing live in refreshAuthSession.
    warmSession(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only warm
  }, []);

  const publicShell = isPublicShellRoute(pathname);

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="content-inner">
          {!publicShell ? (
            <div
              aria-label="Session actions"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                minHeight: 40,
                marginBottom: 8,
                position: "relative",
                zIndex: 20
              }}
            >
              <LogoutButton />
            </div>
          ) : null}
          {sessionDegraded ? (
            <section
              className="panel error-panel session-degraded-banner"
              role="alert"
              data-testid="session-degraded"
            >
              <p>
                Session check timed out or failed. Live data may still load with your existing
                cookies — retry if the workspace looks empty.
              </p>
              <button
                type="button"
                className="secondary-button"
                data-testid="session-retry"
                onClick={() => warmSession(true)}
              >
                Retry session
              </button>
            </section>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
