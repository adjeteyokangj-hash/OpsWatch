import Link from "next/link";
import { PageSection } from "../ui/page-section";

type RelatedIncident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  project: { id: string; name: string };
};

type Props = {
  correlationGroup: {
    id: string;
    correlationKey: string;
    rootCauseSummary: string | null;
    primaryIncidentId: string | null;
    relatedIncidents: RelatedIncident[];
  };
  currentIncidentId: string;
};

export const IncidentOrgCorrelationPanel = ({ correlationGroup, currentIncidentId }: Props) => {
  const others = correlationGroup.relatedIncidents.filter((row) => row.id !== currentIncidentId);
  if (others.length === 0) return null;

  return (
    <PageSection
      title="Cross-application correlation"
      description={
        correlationGroup.rootCauseSummary ??
        "This incident is linked to related failures across multiple applications in your organization."
      }
      persistKey={`incident:${currentIncidentId}:org-correlation`}
    >
      <p className="metric-label">Correlation key: {correlationGroup.correlationKey}</p>
      <ul className="list">
        {others.map((row) => (
          <li key={row.id}>
            <Link href={`/incidents/${row.id}`}>{row.title}</Link>
            <span className="pill">{row.project.name}</span>
            <span className="severity">{row.severity}</span>
          </li>
        ))}
      </ul>
      {correlationGroup.primaryIncidentId === currentIncidentId ? (
        <p className="content">This incident is the primary incident for the organization-wide group.</p>
      ) : null}
    </PageSection>
  );
};
