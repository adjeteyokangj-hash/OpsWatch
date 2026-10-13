import Link from "next/link";
import type { ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  media
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  media?: ReactNode;
}) {
  return (
    <section className={`ow-page-hero${media ? " ow-page-hero--split" : ""}`}>
      <div className="ow-page-hero-copy">
        {eyebrow ? <p className="ow-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="ow-lead">{subtitle}</p>
        {actions ? <div className="ow-hero-actions">{actions}</div> : null}
      </div>
      {media ? <div className="ow-page-hero-media">{media}</div> : null}
    </section>
  );
}

export function PrimaryCta({ href = "/register", label = "Start monitoring" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="ow-btn ow-btn-primary">
      {label}
    </Link>
  );
}

export function SecondaryCta({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="ow-btn ow-btn-outline">
      {label}
    </Link>
  );
}
