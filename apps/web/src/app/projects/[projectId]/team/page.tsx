"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ProjectTeamRedirectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/projects/${projectId}/contacts`);
  }, [projectId, router]);

  return null;
}
