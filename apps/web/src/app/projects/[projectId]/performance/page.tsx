"use client";

import { Suspense } from "react";
import { ProjectPerformancePageInner } from "./performance-inner";

export default function ProjectPerformancePage() {
  return (
    <Suspense fallback={<div className="panel">Loading performance…</div>}>
      <ProjectPerformancePageInner />
    </Suspense>
  );
}
