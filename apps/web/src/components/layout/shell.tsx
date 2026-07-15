"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { hasSessionCookie, refreshAuthSession } from "../../lib/auth";

/**
 * Authenticated app chrome. Middleware already enforced the session cookie;
 * do not gate page content on a client /auth/session probe — hung session
 * fetches previously left mobile (and desktop) stuck on “Loading workspace…”.
 */
export function Shell({ children }: { children: ReactNode }) {
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

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="content-inner">
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
