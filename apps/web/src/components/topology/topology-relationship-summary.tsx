import {
  buildNodeRelationshipDiagnostics,
  summarizeRelationshipDiagnostics,
  type NodeRelationshipDiagnostic
} from "./topology-relationship";
import type { ProjectTopologyResponse } from "./topology-types";

type Props = {
  topology: ProjectTopologyResponse;
  diagnostics?: NodeRelationshipDiagnostic[];
};

export function TopologyRelationshipSummary({ topology, diagnostics }: Props) {
  const rows = diagnostics ?? buildNodeRelationshipDiagnostics(topology);
  const summary = summarizeRelationshipDiagnostics(rows);

  return (
    <section className="topology-relationship-summary" data-testid="topology-relationship-summary" aria-label="Topology relationship summary">
      <span>
        <strong>{summary.totalModules}</strong> modules
      </span>
      <span>
        <strong>{summary.connectedModules}</strong> connected
      </span>
      <span>
        <strong>{summary.unconnectedModules}</strong> unconnected
      </span>
      <span>
        <strong>{summary.discoveryPendingModules}</strong> discovery pending
      </span>
      <span>
        <strong>{topology.edges.length}</strong> relationships
      </span>
    </section>
  );
}
