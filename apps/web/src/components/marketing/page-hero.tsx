import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  media,
  style
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  media?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className={`ow-page-hero${media ? " ow-page-hero--split" : ""}`} style={style}>
      <div className="ow-page-hero-copy">
        {eyebrow ? <p className="ow-eyebrow ow-eyebrow--dark">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="ow-lead">{subtitle}</p>
        {actions ? <div className="ow-hero-actions">{actions}</div> : null}
      </div>
      {media ? <div className="ow-page-hero-media">{media}</div> : null}
    </section>
  );
}

export function PrimaryCta({
  href = "/register",
  label = "Start monitoring",
  style
}: {
  href?: string;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <Link href={href} className="ow-btn ow-btn-primary" style={style}>
      {label}
    </Link>
  );
}

export function SecondaryCta({
  href,
  label,
  style
}: {
  href: string;
  label: string;
  style?: CSSProperties;
}) {
  return (
    <Link href={href} className="ow-btn ow-btn-outline" style={style}>
      {label}
    </Link>
  );
}
