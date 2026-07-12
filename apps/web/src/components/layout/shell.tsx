"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { refreshAuthSession } from "../../lib/auth";

export function Shell({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    void refreshAuthSession().finally(() => setSessionReady(true));
  }, []);

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="content-inner">
          {sessionReady ? children : (
            <section className="panel workspace-loading">
              <div className="loading-pulse" />
              <p>Loading workspace…</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
