"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Legacy Services tab — Components is the canonical label/route. */
export default function ProjectServicesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/projects/${projectId}/components`);
  }, [projectId, router]);

  return (
    <section className="panel" aria-live="polite">
      Redirecting to Components…
    </section>
  );
}
