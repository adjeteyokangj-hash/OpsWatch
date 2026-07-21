import Link from "next/link";
import { PageSection } from "../ui/page-section";
import type { DiagnosisResult } from "./incident-diagnosis-types";
import { layerLabel, serviceDetailHref, statusLabel } from "./incident-diagnosis-types";

type Props = {
  incidentId: string;
  diagnosis: DiagnosisResult;
  projectId?: string;
};

const nodeStatusClass = (status: string): string => {
  if (status === "ROOT_CAUSE") return "propagation-status root-cause";
  if (status === "DEGRADED") return "propagation-status degraded";
  if (status === "AFFECTED") return "propagation-status affected";
  return "propagation-status unaffected";
};

export function IncidentPropagationChain({ incidentId, diagnosis, projectId }: Props) {
  const rootCause = diagnosis.dependencyImpact?.probableRootCause;
  const path =
    diagnosis.dependencyImpact?.propagationPath ??
    (rootCause
      ? [
          {
            serviceId: rootCause.serviceId ?? "root",
            serviceName: rootCause.serviceName,
            layer: rootCause.layer as any,
            status: "ROOT_CAUSE" as const
          }
        ]
      : []);

  if (path.length === 0) return null;

  return (
    <PageSection
      title="Propagation chain"
      description="Directional cascade from upstream failure through runtime dependencies."
      className="incident-propagation-panel"
      persistKey={`incident:${incidentId}:propagation-chain`}
    >
      <div className="propagation-chain">
        {path.map((node, index) => (
          <div key={node.serviceId} className="propagation-hop">
            {index > 0 ? <div className="propagation-arrow" aria-hidden="true">↓</div> : null}
            <article className="propagation-node">
              <div className="propagation-node-head">
                <Link href={serviceDetailHref(node.serviceId, projectId)} className="propagation-node-link">
                  {node.serviceName}
                </Link>
                <span className={nodeStatusClass(node.status)}>{statusLabel(node.status)}</span>
              </div>
              <p className="propagation-node-layer">{layerLabel(node.layer)}</p>
            </article>
          </div>
        ))}
      </div>
    </PageSection>
  );
}
