"use client";

import { type ReactNode, useEffect, useId, useState } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** When true, body starts collapsed; expand via the section header. */
  defaultCollapsed?: boolean;
  /**
   * Persist open/closed in localStorage under `opswatch:page-section:<persistKey>`.
   * Prefer a stable page+section id (e.g. `project:abc:checks`).
   */
  persistKey?: string;
  /**
   * When false, render a static panel (no collapse control).
   * Use for tiny chrome, loading shells, or panels that must stay fully interactive without a disclosure.
   */
  collapsible?: boolean;
  /** Optional accessible name override for the region. */
  "aria-label"?: string;
};

export const pageSectionStorageKey = (persistKey: string) => `opswatch:page-section:${persistKey}`;

const readPersistedOpen = (persistKey: string | undefined, fallback: boolean): boolean => {
  if (!persistKey || typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(pageSectionStorageKey(persistKey));
    if (stored === "expanded") return true;
    if (stored === "collapsed") return false;
  } catch {
    // Ignore private mode / blocked storage.
  }
  return fallback;
};

const writePersistedOpen = (persistKey: string | undefined, open: boolean) => {
  if (!persistKey) return;
  try {
    window.localStorage.setItem(pageSectionStorageKey(persistKey), open ? "expanded" : "collapsed");
  } catch {
    // Ignore private mode / blocked storage.
  }
};

export function PageSection({
  title,
  description,
  actions,
  children,
  className = "",
  defaultCollapsed = false,
  persistKey,
  collapsible = true,
  "aria-label": ariaLabel
}: Props) {
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const classes = `panel page-section ${className}`.trim();
  const [open, setOpen] = useState(() => !defaultCollapsed);

  useEffect(() => {
    if (!persistKey) return;
    setOpen(readPersistedOpen(persistKey, !defaultCollapsed));
  }, [persistKey, defaultCollapsed]);

  const head = (
    <>
      <div>
        <h2 id={titleId}>{title}</h2>
        {description ? <p className="dashboard-subtle">{description}</p> : null}
      </div>
      {actions ? (
        <div
          className="section-actions"
          onClick={(event) => {
            // Keep header action controls from toggling the disclosure.
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {actions}
        </div>
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <section className={classes} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleId}>
        <div className="section-head">{head}</div>
        {children}
      </section>
    );
  }

  return (
    <details className={classes} open={open} aria-label={ariaLabel}>
      <summary
        className="section-head page-section-summary"
        aria-labelledby={titleId}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          const next = !open;
          setOpen(next);
          writePersistedOpen(persistKey, next);
        }}
      >
        <span className="page-section-chevron" aria-hidden="true" />
        {head}
      </summary>
      <div className="page-section-body">{children}</div>
    </details>
  );
}
