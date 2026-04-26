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
  if (href) {
    return (
      <Link href={href} className="stat-card-link">
        <article className="stat-card">
          <div className="label">{label}</div>
          <div className="value">{value}</div>
        </article>
      </Link>
    );
  }

  return (
    <article className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </article>
  );
}
