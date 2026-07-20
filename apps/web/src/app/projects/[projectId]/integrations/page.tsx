import { redirect } from "next/navigation";

/** Legacy/mistyped path ? project integrations live at /integrations/:projectId */
export default async function ProjectIntegrationsIndexRedirect({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const resolved = await params;
  redirect(`/integrations/${resolved.projectId}`);
}
