"use client";

type Props = {
  minutesAgo: number;
  maxMinutes?: number;
  onChange: (minutesAgo: number) => void;
};

const formatClock = (minutesAgo: number): string => {
  const now = new Date();
  const replay = new Date(now.getTime() - minutesAgo * 60_000);
  return replay.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function TopologyTimeReplay({ minutesAgo, maxMinutes = 45, onChange }: Props) {
  return (
    <section className="topology-time-replay panel" aria-label="Topology time replay">
      <div className="topology-time-replay-head">
        <strong>Time replay</strong>
        <span className="topology-time-replay-clock">
          {formatClock(minutesAgo)} {minutesAgo > 0 ? `(${minutesAgo}m ago)` : "(live)"}
        </span>
      </div>
      <input
        type="range"
        className="topology-time-replay-slider"
        min={0}
        max={maxMinutes}
        step={1}
        value={minutesAgo}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Scrub topology history"
      />
      <div className="topology-time-replay-labels">
        <span>Live</span>
        <span>{maxMinutes}m ago</span>
      </div>
      <p className="field-hint">Scrub backward to replay how health and traffic evolved during an incident.</p>
    </section>
  );
}
