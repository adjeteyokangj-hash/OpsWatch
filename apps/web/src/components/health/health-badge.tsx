import { healthLabel, healthTone } from "../../lib/health-tones";

type Props = {
  status: string;
  displayLabel?: string | null;
  className?: string;
};

export function HealthBadge({ status, displayLabel, className = "" }: Props) {
  const tone = healthTone(status);
  return (
    <span className={`result-pill pill ${tone} ${className}`.trim()} title={status}>
      {healthLabel(status, displayLabel)}
    </span>
  );
}
