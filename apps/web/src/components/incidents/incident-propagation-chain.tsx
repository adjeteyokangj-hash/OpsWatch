import Link from "next/link";
import type { DiagnosisResult } from "./incident-diagnosis-types";
import { layerLabel, serviceDetailHref, statusLabel } from "./incident-diagnosis-types";

type Props = {
  diagnosis: DiagnosisResult;
  projectId?: string;
};

const nodeStatusClass = (status: string): string => {
  if (status === "ROOT_CAUSE") return "propagation-status root-cause";
  if (status === "DEGRADED") return "propagation-status degraded";
  if (status === "AFFECTED") return "propagation-status affected";
  return "propagation-status unaffected";
};

export function IncidentPropagationChain({ diagnosis, projectId }: Props) {
  const path =
    diagnosis.dependencyImpact?.propagationPath ??
    diagnosis.dependencyImpact?.probableRootCause
      ? [
          {
            serviceId: diagnosis.dependencyImpact.probableRootCause!.serviceId ?? "root",
            serviceName: diagnosis.dependencyImpact.probableRootCause!.serviceName,
            layer: diagnosis.dependencyImpact.probableRootCause!.layer as any,
            status: "ROOT_CAUSE" as const
          }
        ]
      : [];

  if (path.length === 0) return null;

  return (
    <section className="panel incident-propagation-panel">
      <h2>Propagation chain</h2>
      <p className="dashboard-subtle">
        Directional cascade from upstream failure through runtime dependencies.
      </p>
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
    </section>
  );
}
