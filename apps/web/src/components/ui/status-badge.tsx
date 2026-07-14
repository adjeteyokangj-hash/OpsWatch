import type { ReactNode } from "react";

const TONE_CLASS: Record<string, string> = {
  success: "status-badge status-badge-success",
  warning: "status-badge status-badge-warning",
  danger: "status-badge status-badge-danger",
  info: "status-badge status-badge-info",
  neutral: "status-badge status-badge-neutral",
  muted: "status-badge status-badge-muted"
};

export function StatusBadge({
  label,
  tone = "neutral",
  title
}: {
  label: ReactNode;
  tone?: keyof typeof TONE_CLASS;
  title?: string;
}) {
  return (
    <span className={TONE_CLASS[tone] ?? TONE_CLASS.neutral} title={title}>
      {label}
    </span>
  );
}

export function severityTone(severity: string | null | undefined): keyof typeof TONE_CLASS {
  const value = (severity || "").toUpperCase();
  if (value === "CRITICAL" || value === "HIGH" || value === "DOWN") return "danger";
  if (value === "MEDIUM" || value === "WARN" || value === "DEGRADED") return "warning";
  if (value === "LOW" || value === "HEALTHY" || value === "PASS") return "success";
  return "neutral";
}
