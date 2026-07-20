import { PageSection } from "../ui/page-section";
import type { ProjectTopologyResponse, TopologyHealthStatus, TopologyNodeType } from "./topology-types";
import { canonicalDiscoveryLabel, healthClassName, healthLabel } from "./topology-types";

type Props = {
  topology: ProjectTopologyResponse;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  typeFilter: TopologyNodeType | "ALL";
  healthFilter: TopologyHealthStatus | "ALL";
  locationFilter: string;
  provenanceFilter: string;
  freshnessFilter: "ALL" | "FRESH" | "STALE" | "INACTIVE" | "UNKNOWN";
  searchQuery: string;
};

export function TopologyListView({
  topology,
  selectedNodeId,
  onSelectNode,
  typeFilter,
  healthFilter,
  locationFilter,
  provenanceFilter,
  freshnessFilter,
  searchQuery
}: Props) {
  const rows = topology.nodes.filter((node) => {
    if (typeFilter !== "ALL" && node.type !== typeFilter) return false;
    if (healthFilter !== "ALL" && node.status !== healthFilter) return false;
    const canonical = topology.nodeContext[node.id]?.canonical;
    if (
      locationFilter !== "ALL" &&
      (locationFilter === "UNBOUND"
        ? canonical?.location != null
        : canonical?.location?.id !== locationFilter)
    ) {
      return false;
    }
    if (
      provenanceFilter !== "ALL" &&
      canonical?.provenance !== provenanceFilter
    ) {
      return false;
    }
    if (
      freshnessFilter !== "ALL" &&
      canonical?.freshness !== freshnessFilter
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      if (!node.name.toLowerCase().includes(query) && !node.type.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  return (
    <PageSection
      title="Node list"
      description="Filtered topology nodes in tabular form."
      className="topology-list-view"
      persistKey={`project:${topology.project.id}:topology:list`}
    >
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Layer</th>
            <th>Health</th>
            <th>Location</th>
            <th>Source</th>
            <th>Discovery state</th>
            <th>Alerts</th>
            <th>Incidents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => (
            <tr
              key={node.id}
              className={selectedNodeId === node.id ? "selected-row" : undefined}
              onClick={() => onSelectNode(node.id)}
            >
              <td>{node.name}</td>
              <td>{node.type}</td>
              <td>
                <span className={`topology-list-pill ${healthClassName(node.status)}`}>{healthLabel(node.status)}</span>
              </td>
              <td>{topology.nodeContext[node.id]?.canonical?.location?.name ?? "Unbound"}</td>
              <td>{topology.nodeContext[node.id]?.canonical?.provenance ?? "Legacy"}</td>
              <td>{canonicalDiscoveryLabel(topology.nodeContext[node.id]?.canonical)}</td>
              <td>{node.risk.openAlerts}</td>
              <td>{node.risk.unresolvedIncidents}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="dashboard-subtle topology-list-empty">No nodes match the current filters.</p> : null}
    </PageSection>
  );
}
