"use client";

import Link from "next/link";
import { ProjectConnectionsPanel } from "../../components/integrations/project-connections-panel";
import type { ConnectionRecord } from "../connections/types";
import {
  summarizeProjectIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../lib/integrations";

type ProjectIntegrationRowProps = {
  project: ProjectOption;
  integrations: ProjectIntegration[];
  monitoringConnections?: ConnectionRecord[];
  expanded: boolean;
  onToggle: () => void;
  validatingKey?: string | null;
  onValidate?: (projectId: string, type: IntegrationType) => void;
};

export const ProjectIntegrationRow = ({
  project,
  integrations,
  monitoringConnections = [],
  expanded,
  onToggle,
  validatingKey,
  onValidate
}: ProjectIntegrationRowProps) => {
  const summary = summarizeProjectIntegrations(project.id, integrations);
  const projectConnections = monitoringConnections.filter((row) => row.project?.id === project.id);
  const primaryConnection =
    projectConnections.find(
      (row) => row.isActive && String(row.health).toUpperCase() === "HEALTHY"
    ) ??
    projectConnections.find((row) => row.isActive) ??
    projectConnections[0];
  const connectionHealthy = Boolean(
    primaryConnection?.isActive && String(primaryConnection.health).toUpperCase() === "HEALTHY"
  );
  const rowIcon = primaryConnection ? (connectionHealthy ? "🟢" : "🟡") : summary.overallIcon;
  const rowLabel = primaryConnection
    ? connectionHealthy
      ? `Monitoring connected${summary.connected > 0 ? ` · ${summary.connected} provider capability${summary.connected === 1 ? "" : "ies"}` : ""}`
      : "Monitoring connection needs attention"
    : summary.overallLabel;
  const attentionMessage = primaryConnection && !connectionHealthy
    ? primaryConnection.lastError ?? "Test the monitoring connection and review its latest health result."
    : summary.attentionMessage;

  return (
    <article className={`project-integration-row ${expanded ? "project-integration-row--expanded" : ""}`}>
      <button type="button" className="project-integration-row__toggle" onClick={onToggle} aria-expanded={expanded}>
        <div className="project-integration-row__summary">
          <span className="project-integration-row__icon" aria-hidden="true">
            {rowIcon}
          </span>
          <div>
            <strong>{project.name}</strong>
            <p className="table-subtle">{rowLabel}</p>
            {attentionMessage ? <p className="project-integration-row__attention">{attentionMessage}</p> : null}
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
            monitoringConnections={projectConnections}
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
