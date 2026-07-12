import type { VisualLayer } from "./topology-visual-layers";

type Props = {
  points?: number[];
  seed: string;
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

const fallbackPoints = (seed: string): number[] => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 3)) % 97;
  return Array.from({ length: 12 }, (_, index) => 72 + Math.sin((hash + index * 11) * 0.31) * 18);
};

export function TopologySparkline({ points, seed, tone }: Props) {
  const color = toneColor[tone] ?? toneColor.neutral;
  const series = points && points.length > 1 ? points : fallbackPoints(seed);
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
    <svg className="topology-kpi-sparkline" viewBox="0 0 132 28" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={polyline} />
    </svg>
  );
}

export const layerSparkTone = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "module";
  if (layer === "WORKFLOW") return "workflow";
  if (layer === "SERVICE") return "service";
  return "neutral";
};
