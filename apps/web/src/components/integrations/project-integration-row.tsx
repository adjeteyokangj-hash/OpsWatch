"use client";

import Link from "next/link";
import { ProjectConnectionsPanel } from "../../components/integrations/project-connections-panel";
import {
  summarizeProjectIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../lib/integrations";

type ProjectIntegrationRowProps = {
  project: ProjectOption;
  integrations: ProjectIntegration[];
  expanded: boolean;
  onToggle: () => void;
  validatingKey?: string | null;
  onValidate?: (projectId: string, type: IntegrationType) => void;
};

export const ProjectIntegrationRow = ({
  project,
  integrations,
  expanded,
  onToggle,
  validatingKey,
  onValidate
}: ProjectIntegrationRowProps) => {
  const summary = summarizeProjectIntegrations(project.id, integrations);

  return (
    <article className={`project-integration-row ${expanded ? "project-integration-row--expanded" : ""}`}>
      <button type="button" className="project-integration-row__toggle" onClick={onToggle} aria-expanded={expanded}>
        <div className="project-integration-row__summary">
          <span className="project-integration-row__icon" aria-hidden="true">
            {summary.overallIcon}
          </span>
          <div>
            <strong>{project.name}</strong>
            <p className="table-subtle">{summary.overallLabel}</p>
            {summary.attentionMessage ? <p className="project-integration-row__attention">{summary.attentionMessage}</p> : null}
          </div>
        </div>
        <span className="project-integration-row__chevron" aria-hidden="true">
          {expanded ? "⌄" : "›"}
        </span>
      </button>

      {expanded ? (
        <div className="project-integration-row__body">
          <ProjectConnectionsPanel
            project={project}
            integrations={integrations}
            validatingKey={validatingKey}
            onValidate={onValidate}
            compact
          />
        </div>
      ) : null}

      {!expanded ? (
        <div className="project-integration-row__footer">
          <Link className="table-subtle" href={`/integrations/${project.id}`}>
            Open {project.name} integrations →
          </Link>
        </div>
      ) : null}
    </article>
  );
};
