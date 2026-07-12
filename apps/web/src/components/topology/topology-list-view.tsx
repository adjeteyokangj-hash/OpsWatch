import type { ProjectTopologyResponse, TopologyHealthStatus, TopologyNodeType } from "./topology-types";
import { healthClassName, healthLabel } from "./topology-types";

type Props = {
  topology: ProjectTopologyResponse;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  typeFilter: TopologyNodeType | "ALL";
  healthFilter: TopologyHealthStatus | "ALL";
  searchQuery: string;
};

export function TopologyListView({
  topology,
  selectedNodeId,
  onSelectNode,
  typeFilter,
  healthFilter,
  searchQuery
}: Props) {
  const rows = topology.nodes.filter((node) => {
    if (typeFilter !== "ALL" && node.type !== typeFilter) return false;
    if (healthFilter !== "ALL" && node.status !== healthFilter) return false;
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      if (!node.name.toLowerCase().includes(query) && !node.type.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  return (
    <section className="topology-list-view panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Layer</th>
            <th>Health</th>
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
              <td>{node.risk.openAlerts}</td>
              <td>{node.risk.unresolvedIncidents}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="dashboard-subtle topology-list-empty">No nodes match the current filters.</p> : null}
    </section>
  );
}
