"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

export default function StatusPageDetail() {
  const params = useParams<{ id: string }>();
  const [pages, setPages] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const rows = await apiFetch<any[]>("/org/status-pages");
      setPages(rows);
    };
    void load();
  }, []);

  const page = useMemo(() => pages.find((row) => row.id === params.id), [pages, params.id]);

  return (
    <Shell>
      <Header title="Status Page" />
      <section className="panel">
        {!page ? <p>Loading status page...</p> : (
          <>
            <p><strong>Title:</strong> {page.title}</p>
            <p><strong>Public URL:</strong> <a href={`/status/${page.slug}`} target="_blank" rel="noreferrer">/status/{page.slug}</a></p>
            <p><strong>Visibility:</strong> {page.isPublic ? "Public" : "Private"}</p>
            <p><strong>Slug:</strong> {page.slug}</p>
            <p className="table-subtle">Regenerating slugs should be treated as a breaking public URL change.</p>
            <Link className="primary-button" href="/org">Back to Organization</Link>
          </>
        )}
      </section>
    </Shell>
  );
}
