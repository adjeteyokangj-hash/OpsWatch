type Props = {
  seed: string;
  tone: string;
};

const toneColor: Record<string, string> = {
  healthy: "#16a34a",
  degraded: "#d97706",
  critical: "#dc2626",
  warn: "#d97706",
  neutral: "#94a3b8"
};

export function TopologySparkline({ seed, tone }: Props) {
  const color = toneColor[tone] ?? toneColor.neutral;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 3)) % 97;

  const points = Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((hash + index * 11) * 0.31) * 10;
    const trend = index * 1.4;
    const x = 4 + index * 11;
    const y = 22 - trend / 3 - wave;
    return `${x},${Math.max(6, Math.min(24, y))}`;
  }).join(" ");

  return (
    <svg className="topology-kpi-sparkline" viewBox="0 0 132 28" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}
