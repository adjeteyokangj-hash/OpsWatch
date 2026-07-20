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
  /** Optional test id forwarded to the root panel element. */
  "data-testid"?: string;
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
  "aria-label": ariaLabel,
  "data-testid": dataTestId
}: Props) {
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const bodyId = `${reactId}-body`;
  const classes = `panel page-section ${className}`.trim();
  const [open, setOpen] = useState(() => !defaultCollapsed);

  useEffect(() => {
    if (!persistKey) return;
    setOpen(readPersistedOpen(persistKey, !defaultCollapsed));
  }, [persistKey, defaultCollapsed]);

  if (!collapsible) {
    return (
      <section
        className={classes}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        data-testid={dataTestId}
      >
        <div className="section-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="dashboard-subtle">{description}</p> : null}
          </div>
          {actions ? <div className="section-actions">{actions}</div> : null}
        </div>
        {children}
      </section>
    );
  }

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      writePersistedOpen(persistKey, next);
      return next;
    });
  };

  return (
    <section
      className={`${classes}${open ? " is-open" : " is-collapsed"}`}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
      data-testid={dataTestId}
      data-open={open ? "true" : "false"}
    >
      <div className="section-head page-section-summary-row">
        <button
          type="button"
          className="page-section-summary"
          aria-labelledby={titleId}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="page-section-chevron" aria-hidden="true" />
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="dashboard-subtle">{description}</p> : null}
          </div>
        </button>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {/* Keep children mounted while collapsed so forms retain typed state. */}
      <div id={bodyId} className="page-section-body" hidden={!open} aria-hidden={!open}>
        {children}
      </div>
    </section>
  );
}
