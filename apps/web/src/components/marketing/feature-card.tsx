"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

export type CapabilityState = "Live" | "Available" | "Preview" | "Foundation" | "Coming soon";

const ICONS: Record<string, string> = {
  "Agentless health checks": "⌁",
  "Advanced topology": "⬡",
  "Governed remediation": "↺",
  "Application monitoring": "▣",
  "Automated recovery": "⚙",
  "Security controls": "⛨"
};

export function FeatureCard({
  title,
  body,
  state,
  href,
  icon,
  style
}: {
  title: string;
  body: string;
  state: CapabilityState;
  href?: string;
  icon?: string;
  style?: CSSProperties;
}) {
  const [active, setActive] = useState(false);
  const glyph = icon ?? ICONS[title] ?? "◆";
  const content = (
    <>
      <div className="ow-feature-card-top">
        <span className="ow-feature-icon" aria-hidden="true">
          {glyph}
        </span>
        <span className={`ow-state ow-state--${state.toLowerCase().replace(" ", "-")}`}>{state}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {href ? <span className="ow-feature-link">Learn more</span> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`ow-feature-card${active ? " is-active" : ""}`}
        style={style}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      >
        {content}
      </Link>
    );
  }

  return (
    <article
      className={`ow-feature-card${active ? " is-active" : ""}`}
      style={style}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {content}
    </article>
  );
}
