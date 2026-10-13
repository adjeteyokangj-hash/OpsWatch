"use client";

import Link from "next/link";
import { useState } from "react";

export type CapabilityState = "Live" | "Preview" | "Foundation" | "Coming soon";

export function FeatureCard({
  title,
  body,
  state,
  href
}: {
  title: string;
  body: string;
  state: CapabilityState;
  href?: string;
}) {
  const [active, setActive] = useState(false);
  const content = (
    <>
      <div className="ow-feature-card-top">
        <h3>{title}</h3>
        <span className={`ow-state ow-state--${state.toLowerCase().replace(" ", "-")}`}>{state}</span>
      </div>
      <p>{body}</p>
      {href ? <span className="ow-feature-link">Learn more</span> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`ow-feature-card${active ? " is-active" : ""}`}
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
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {content}
    </article>
  );
}
