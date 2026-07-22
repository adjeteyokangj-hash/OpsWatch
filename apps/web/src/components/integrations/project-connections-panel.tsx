"use client";

import Link from "next/link";
import { ConnectionTile, type ProviderCapabilityAvailability } from "./connection-tile";
import type { ConnectionRecord } from "../connections/types";
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
  monitoringConnections?: ConnectionRecord[];
  validatingKey?: string | null;
  onValidate?: (projectId: string, type: IntegrationType) => void;
  compact?: boolean;
};

const capabilityDescription: Record<IntegrationType, string> = {
  WEBHOOK: "Optional general event delivery endpoint.",
  EMAIL: "Optional provider health check for outbound email delivery.",
  STRIPE: "Billing provider configuration.",
  WORKER_PROVIDER: "Required for signed retry and worker-recovery actions.",
  SERVICE_PROVIDER: "Requires a safe service restart endpoint exposed by the application.",
  DEPLOYMENT_PROVIDER: "Requires a supported deployment rollback endpoint.",
  STATUS_PROVIDER: "Optional external status page source.",
  RUNBOOK_PROVIDER: "Optional link to operational procedures and owners."
};

const capabilityAvailability = (
  type: IntegrationType,
  configured: boolean,
  isTrueNumeris: boolean
): ProviderCapabilityAvailability => {
  if (configured) return "required";
  if (isTrueNumeris && type === "WORKER_PROVIDER") return "required";
  if (type === "SERVICE_PROVIDER" || type === "DEPLOYMENT_PROVIDER") return "unavailable";
  if (type === "WORKER_PROVIDER") return "unavailable";
  return "optional";
};

const connectionHealthLabel = (connection: ConnectionRecord | undefined): string => {
  if (!connection) return "Not connected";
  if (!connection.isActive) return "Disabled";
  return String(connection.health).toUpperCase() === "HEALTHY" ? "Connected" : "Needs attention";
};

export const ProjectConnectionsPanel = ({
  project,
  integrations,
  monitoringConnections = [],
  validatingKey = null,
  onValidate,
  compact = false
}: ProjectConnectionsPanelProps) => {
  const summary = summarizeProjectIntegrations(project.id, integrations);
  const projectConnections = monitoringConnections.filter((row) => row.project?.id === project.id);
  const primaryConnection =
    projectConnections.find((row) => row.isActive && String(row.health).toUpperCase() === "HEALTHY") ??
    projectConnections.find((row) => row.isActive) ??
    projectConnections[0];
  const isTrueNumeris = projectConnections.some((row) =>
    /truenumeris/i.test(`${row.name} ${row.baseUrl ?? ""}`)
  );

  return (
    <div className="project-connections-panel">
      <div className="project-connections-panel__head">
        <div>
          <h3>{project.name} connections</h3>
          <p className="table-subtle">
            {primaryConnection
              ? `${connectionHealthLabel(primaryConnection)} monitoring source · ${summary.connected} provider capability${summary.connected === 1 ? "" : "ies"} connected`
              : "Connect a monitoring source first; provider capabilities are added only when needed."}
          </p>
        </div>
        <Link className="secondary-button" href={`/connections?projectId=${encodeURIComponent(project.id)}`}>
          Open monitoring workspace
        </Link>
      </div>

      {!compact ? (
        <article className="connection-tile">
          <div className="connection-tile__head">
            <strong>{isTrueNumeris ? "TrueNumeris monitoring connection" : "Primary monitoring connection"}</strong>
            <span className="connection-tile__status">
              <span aria-hidden="true">
                {primaryConnection
                  ? String(primaryConnection.health).toUpperCase() === "HEALTHY" && primaryConnection.isActive
                    ? "🟢"
                    : "🟡"
                  : "⚪"}
              </span>
              <span>{connectionHealthLabel(primaryConnection)}</span>
            </span>
          </div>
          {primaryConnection ? (
            <dl className="connection-tile__meta">
              <div>
                <dt>Name</dt>
                <dd>{primaryConnection.name}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{primaryConnection.environment}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{primaryConnection.baseUrl ?? "Not supplied"}</dd>
              </div>
              <div>
                <dt>Last validation</dt>
                <dd>{primaryConnection.lastValidatedAt ? new Date(primaryConnection.lastValidatedAt).toLocaleString() : "Never"}</dd>
              </div>
            </dl>
          ) : (
            <p className="table-subtle">No monitoring connection is linked to this application yet.</p>
          )}
        </article>
      ) : null}

      <div className="connection-tile-grid">
        {OPERATIONAL_INTEGRATION_TYPES.map((type) => {
          const key = `${project.id}:${type}`;
          const row = integrations.find(
            (integration) => integration.projectId === project.id && integration.type === type
          );
          return (
            <ConnectionTile
              key={key}
              projectId={project.id}
              type={type}
              integration={row}
              validating={validatingKey === key}
              onValidate={onValidate ? () => onValidate(project.id, type) : undefined}
              compact={compact}
              capabilityAvailability={capabilityAvailability(type, Boolean(row), isTrueNumeris)}
              capabilityDescription={capabilityDescription[type]}
            />
          );
        })}
      </div>
    </div>
  );
};
