"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { apiFetch } from "../../../../lib/api";

export default function ProjectActivityPage() {
  const params = useParams<{ projectId: string }>();
  const [project, setProject] = useState<any | null>(null);

  useEffect(() => {
    if (!params.projectId) return;
    const load = async () => {
      const row = await apiFetch<any>(`/projects/${params.projectId}`);
      setProject(row);
    };
    void load();
  }, [params.projectId]);

  return (
    <Shell>
      <Header title="Project Activity" />
      <section className="panel">
        {!project ? <p>Loading activity...</p> : (
          <>
            <p><strong>Latest heartbeat:</strong> {project.heartbeats?.[0]?.receivedAt ? new Date(project.heartbeats[0].receivedAt).toLocaleString() : "-"}</p>
            <h2>Recent events</h2>
            <ul>
              {(project.events || []).map((event: any) => (
                <li key={event.id}>{new Date(event.createdAt).toLocaleString()} - {event.type}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Shell>
  );
}
