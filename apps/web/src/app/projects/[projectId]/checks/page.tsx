"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { apiFetch } from "../../../../lib/api";

export default function ProjectChecksPage() {
  const params = useParams<{ projectId: string }>();
  const [checks, setChecks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.projectId) return;
    const load = async () => {
      setLoading(true);
      try {
        const rows = await apiFetch<any[]>(`/checks?projectId=${params.projectId}`);
        setChecks(rows);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [params.projectId]);

  return (
    <Shell>
      <Header title="Project Checks" />
      <section className="panel">
        {loading ? <p>Loading checks...</p> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td><Link href={`/checks/${check.id}`}>{check.name}</Link></td>
                  <td>{check.latestResult?.status || "PENDING"}</td>
                  <td>{check.latestResult?.checkedAt ? new Date(check.latestResult.checkedAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
