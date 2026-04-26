import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <main className="content">{children}</main>
    </div>
  );
}
