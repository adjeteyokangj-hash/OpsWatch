import Link from "next/link";

export function ProjectHealthCard({
  title,
  value,
  href
}: {
  title: string;
  value: string | number;
  href?: string;
}) {
  if (href) {
    return (
      <Link href={href} className="project-health-card-link">
        <article className="panel project-health-card">
          <h3>{title}</h3>
          <div>{value}</div>
        </article>
      </Link>
    );
  }

  return (
    <article className="panel project-health-card">
      <h3>{title}</h3>
      <div>{value}</div>
    </article>
  );
}
