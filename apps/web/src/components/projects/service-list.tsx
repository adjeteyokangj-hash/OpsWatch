import Link from "next/link";
import { HealthBadge } from "../health/health-badge";

const layerTone = (type: string): string => {
  if (type === "APP") return "app";
  if (type === "MODULE") return "module";
  if (type === "WORKFLOW") return "workflow";
  return "component";
};

export function ServiceList({ rows, projectId }: { rows: Array<any>; projectId?: string }) {
  if (rows.length === 0) {
    return (
      <div className="workspace-empty-inline">
        <p>No services in this layer yet.</p>
        <p className="dashboard-subtle">Use <strong>Add service</strong> above, then attach checks from the Checks tab.</p>
      </div>
    );
  }

  return (
    <div className="layer-health-table-wrap">
      <table className="data-table service-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Layer</th>
            <th>Health</th>
            <th>Criticality</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td>
                <span className={`layer-tag ${layerTone(row.type)}`}>{row.type}</span>
              </td>
              <td>
                <HealthBadge status={row.status} />
              </td>
              <td>{row.isCritical ? <span className="criticality-tag">Critical</span> : <span className="dashboard-subtle">Standard</span>}</td>
              <td>
                {projectId ? (
                  <Link className="text-link" href={`/checks?projectId=${projectId}&serviceId=${row.id}`}>
                    View checks
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
