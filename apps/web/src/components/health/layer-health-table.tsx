import Link from "next/link";
import { layerLabel } from "../../lib/health-tones";
import { PageSection } from "../ui/page-section";

export type LayerHealthRow = {
  layer: string;
  label: string;
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
};

const filterHref = (layer: string, bucket: "healthy" | "warning" | "critical" | "unknown"): string => {
  if (layer === "APPLICATION") {
    if (bucket === "healthy") return "/apps?health=HEALTHY";
    if (bucket === "critical") return "/apps?health=DOWN";
    if (bucket === "warning") return "/apps?health=DEGRADED";
    return "/apps?health=UNKNOWN";
  }
  const type = layer === "MODULE" ? "MODULE" : layer === "WORKFLOW" ? "WORKFLOW" : "COMPONENT";
  return `/services?layer=${type}&health=${bucket}`;
};

type Props = {
  rows: LayerHealthRow[];
  loading?: boolean;
};

export function LayerHealthTable({ rows, loading }: Props) {
  if (loading) {
    return (
      <PageSection title="System health overview" description="Four-layer health rollup across the estate.">
        <p>Loading system health overview…</p>
      </PageSection>
    );
  }

  return (
    <PageSection title="System health overview" description="Four-layer health rollup across the estate.">
      <div className="layer-health-table-wrap">
        <table className="data-table layer-health-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Total</th>
              <th>Healthy</th>
              <th>Warning</th>
              <th>Critical</th>
              <th>Awaiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.layer}>
                <td>
                  <strong>{row.label || layerLabel(row.layer)}</strong>
                </td>
                <td>{row.total}</td>
                <td>
                  <Link href={filterHref(row.layer, "healthy")}>{row.healthy}</Link>
                </td>
                <td>
                  <Link href={filterHref(row.layer, "warning")}>{row.warning}</Link>
                </td>
                <td>
                  <Link href={filterHref(row.layer, "critical")}>{row.critical}</Link>
                </td>
                <td>
                  <Link href={filterHref(row.layer, "unknown")}>{row.unknown}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageSection>
  );
}
