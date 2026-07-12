import Link from "next/link";

export function StatCard({
  label,
  value,
  href
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  const normalized = label.toLowerCase();
  const tone = normalized.includes("fail") || normalized.includes("down") || normalized.includes("critical")
    ? "danger"
    : normalized.includes("warn") || normalized.includes("degraded") || normalized.includes("pending")
      ? "warning"
      : normalized.includes("pass") || normalized.includes("healthy") || normalized.includes("success")
        ? "success"
        : "brand";
  if (href) {
    return (
      <Link href={href} className="stat-card-link">
        <article className={`stat-card stat-card-${tone}`}>
          <div className="label">{label}</div>
          <div className="value">{value}</div>
          <div className="stat-card-foot">View details <span aria-hidden="true">→</span></div>
        </article>
      </Link>
    );
  }

  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </article>
  );
}
