import type { VisualLayer } from "./topology-visual-layers";

type Props = {
  points?: number[];
  seed?: string;
  tone: string;
};

const toneColor: Record<string, string> = {
  healthy: "#48BB78",
  degraded: "#ED8936",
  critical: "#E53E3E",
  warn: "#ED8936",
  neutral: "#A0AEC0",
  module: "#48BB78",
  workflow: "#9F7AEA",
  service: "#ED8936"
};

export function TopologySparkline({ points, tone }: Props) {
  const color = toneColor[tone] ?? toneColor.neutral;
  const hasLiveSeries = Boolean(points && points.length > 1);
  const series = hasLiveSeries ? points! : [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1);

  const polyline = series
    .map((value, index) => {
      const x = 4 + index * (124 / Math.max(series.length - 1, 1));
      const y = 24 - ((value - min) / range) * 16;
      return `${x},${Math.max(6, Math.min(24, y))}`;
    })
    .join(" ");

  return (
    <svg
      className={`topology-kpi-sparkline${hasLiveSeries ? "" : " topology-kpi-sparkline--idle"}`}
      viewBox="0 0 132 28"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={hasLiveSeries ? color : "#cbd5e1"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={hasLiveSeries ? undefined : "4 4"}
        opacity={hasLiveSeries ? 1 : 0.65}
        points={polyline}
      />
    </svg>
  );
}

export const layerSparkTone = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "module";
  if (layer === "WORKFLOW") return "workflow";
  if (layer === "SERVICE") return "service";
  return "neutral";
};
