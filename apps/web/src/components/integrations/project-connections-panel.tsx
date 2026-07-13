"use client";

import Link from "next/link";
import { ConnectionTile } from "./connection-tile";
import {
  OPERATIONAL_INTEGRATION_TYPES,
  summarizeProjectIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../lib/integrations";

type ProjectConnectionsPanelProps = {
  project: ProjectOption;
  integrations: ProjectIntegration[];
  validatingKey?: string | null;
  onValidate?: (projectId: string, type: IntegrationType) => void;
  compact?: boolean;
};

export const ProjectConnectionsPanel = ({
  project,
  integrations,
  validatingKey = null,
  onValidate,
  compact = false
}: ProjectConnectionsPanelProps) => {
  const summary = summarizeProjectIntegrations(project.id, integrations);

  return (
    <div className="project-connections-panel">
      <div className="project-connections-panel__head">
        <div>
          <h3>{project.name} connections</h3>
          <p className="table-subtle">{summary.overallLabel}</p>
        </div>
        <Link className="secondary-button" href={`/integrations/${project.id}`}>
          Open workspace
        </Link>
      </div>
      <div className="connection-tile-grid">
        {OPERATIONAL_INTEGRATION_TYPES.map((type) => {
          const key = `${project.id}:${type}`;
          const row = integrations.find((integration) => integration.projectId === project.id && integration.type === type);
          return (
            <ConnectionTile
              key={key}
              projectId={project.id}
              type={type}
              integration={row}
              validating={validatingKey === key}
              onValidate={onValidate ? () => onValidate(project.id, type) : undefined}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  );
};
