"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { LearningStateBanner } from "../../../../components/ui/learning-state-banner";
import { PageSection } from "../../../../components/ui/page-section";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type Recommendation = {
  id: string;
  title: string;
  description: string;
  status: string;
  level?: string;
  riskLevel?: string;
};

type InsightsProject = {
  id: string;
  name: string;
  recommendations?: Recommendation[];
};

type IntelligenceSlice = {
  learningState: string;
  emptyReason: string | null;
  predictions: { enabled: boolean; status: string; reason: string };
  patterns: Array<{
    id: string;
    title: string;
    description: string;
    displayEligible: boolean;
    confidenceScore: number;
    evidenceCount: number;
    projectId?: string | null;
  }>;
  confidenceGates: { minDisplayConfidence: number; minRecommendationConfidence: number };
};

export default function ProjectInsightsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [intel, setIntel] = useState<IntelligenceSlice | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setDataLoading(true);
      try {
        const [insights, intelligence] = await Promise.all([
          apiFetch<{ projects: InsightsProject[] }>("/insights/product").catch(() => ({ projects: [] })),
          apiFetch<IntelligenceSlice>("/intelligence?harvest=false").catch(() => null)
        ]);
        const mine = (insights.projects ?? []).find((row) => row.id === projectId);
        setRecommendations((mine?.recommendations ?? []).filter((row) => row.status === "OPEN"));
        setIntel(intelligence);
      } finally {
        setDataLoading(false);
      }
    };
    if (projectId) void load();
  }, [projectId]);

  const patterns = (intel?.patterns ?? []).filter(
    (row) => row.displayEligible && (!row.projectId || row.projectId === projectId)
  );

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={project ? `${project.name} — Intelligence` : "Intelligence"}
      subtitle="Evidence-backed insights only. Predictions stay disabled until confidence thresholds are met."
      project={project}
      loading={loading}
      error={error}
    >
      <LearningStateBanner
        state={intel?.learningState ?? "LEARNING"}
        message={
          intel?.predictions.enabled
            ? intel.predictions.reason
            : intel?.emptyReason ??
              "Building baselines from operational evidence. No predictive claims are shown."
        }
        action={<Link className="text-link" href="/intelligence">Org Intelligence →</Link>}
      />

      <PageSection title="Product insights" description="Coverage and monitoring recommendations for this application.">
        {dataLoading ? <p>Loading insights…</p> : null}
        {!dataLoading && recommendations.length === 0 ? (
          <EmptyState title="No open recommendations" description="Product insight engine has nothing open for this app." />
        ) : (
          <div className="activity-feed">
            {recommendations.map((row) => (
              <article className="activity-feed-item" key={row.id}>
                <div className="activity-feed-head">
                  {row.level ? <span className="meta-chip">{row.level}</span> : null}
                  {row.riskLevel ? <StatusBadge label={row.riskLevel} tone="warning" /> : null}
                </div>
                <div className="activity-feed-title">{row.title}</div>
                <p>{row.description}</p>
              </article>
            ))}
          </div>
        )}
        <p>
          <Link className="text-link" href="/insights">
            Open full insights →
          </Link>
        </p>
      </PageSection>

      <PageSection
        title="Display-eligible patterns"
        description={`Only patterns at or above confidence ${intel?.confidenceGates.minDisplayConfidence ?? 0.7}.`}
      >
        {patterns.length === 0 ? (
          <EmptyState
            title="No display-ready patterns"
            description="Repeated failures may be stored below threshold until evidence accumulates."
          />
        ) : (
          <div className="activity-feed">
            {patterns.map((row) => (
              <article className="activity-feed-item" key={row.id}>
                <div className="activity-feed-head">
                  <StatusBadge label={`${Math.round(row.confidenceScore * 100)}%`} tone="success" />
                </div>
                <div className="activity-feed-title">{row.title}</div>
                <p>{row.description}</p>
                <p className="activity-feed-meta">{row.evidenceCount} evidence samples</p>
              </article>
            ))}
          </div>
        )}
      </PageSection>
    </ProjectWorkspaceShell>
  );
}
