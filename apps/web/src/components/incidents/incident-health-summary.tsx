import { PageSection } from "../ui/page-section";
import type { AppHealth, DiagnosisResult } from "./incident-diagnosis-types";
import { layerLabel, statusLabel } from "./incident-diagnosis-types";

type Props = {
  incidentId: string;
  projectName: string;
  diagnosis: DiagnosisResult;
};

const appHealthClass = (health: AppHealth): string => {
  if (health === "HEALTHY") return "incident-app-health healthy";
  if (health === "DEGRADED") return "incident-app-health degraded";
  return "incident-app-health down";
};

export function IncidentHealthSummary({ incidentId, projectName, diagnosis }: Props) {
  const appHealth = diagnosis.appHealth ?? diagnosis.dependencyImpact?.appHealth ?? "HEALTHY";
  const root = diagnosis.dependencyImpact?.probableRootCause;
  const modules = diagnosis.layerImpacts?.filter((row) => row.layer === "MODULE") ?? [];
  const affectedModules = modules.filter(
    (row) => row.status === "DEGRADED" || row.status === "AFFECTED" || row.status === "ROOT_CAUSE"
  );
  const unaffectedModules = modules.filter((row) => row.status === "UNAFFECTED");
  const affectedWorkflows = (diagnosis.layerImpacts ?? []).filter(
    (row) => row.layer === "WORKFLOW" && row.status !== "UNAFFECTED"
  );
  const propagationDepth =
    diagnosis.dependencyImpact?.propagationPath?.length ??
    diagnosis.dependencyImpact?.propagationChain?.length ??
    0;

  if (!root && appHealth === "HEALTHY" && affectedModules.length === 0) {
    return null;
  }

  return (
    <PageSection
      title={projectName}
      description="Application health from dependency impact analysis."
      className="incident-health-summary-panel"
      persistKey={`incident:${incidentId}:health-summary`}
      actions={<span className={appHealthClass(appHealth)}>{statusLabel(appHealth)}</span>}
    >
      <div className="incident-health-facts">
        {root ? (
          <p>
            <span className="metric-label">Root cause</span>
            <strong>{root.serviceName}</strong>
            <span className="dashboard-subtle"> ({layerLabel(root.layer as any)})</span>
          </p>
        ) : null}

        {affectedModules.length > 0 ? (
          <p>
            <span className="metric-label">Affected module{affectedModules.length > 1 ? "s" : ""}</span>
            <strong>{affectedModules.map((row) => row.serviceName).join(", ")}</strong>
          </p>
        ) : null}

        {affectedWorkflows.length > 0 ? (
          <p>
            <span className="metric-label">Affected workflow{affectedWorkflows.length > 1 ? "s" : ""}</span>
            <strong>{affectedWorkflows.map((row) => row.serviceName).join(", ")}</strong>
          </p>
        ) : null}

        {unaffectedModules.length > 0 ? (
          <p>
            <span className="metric-label">Unaffected modules</span>
            <span>{unaffectedModules.map((row) => row.serviceName).join(", ")}</span>
          </p>
        ) : null}

        {propagationDepth > 0 ? (
          <p>
            <span className="metric-label">Propagation depth</span>
            <strong>{propagationDepth} hop{propagationDepth === 1 ? "" : "s"}</strong>
          </p>
        ) : null}
      </div>
    </PageSection>
  );
}
