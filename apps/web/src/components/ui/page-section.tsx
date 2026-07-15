import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** When true, body starts collapsed; expand via the section header. */
  defaultCollapsed?: boolean;
};

export function PageSection({
  title,
  description,
  actions,
  children,
  className = "",
  defaultCollapsed = false
}: Props) {
  const classes = `panel page-section ${className}`.trim();
  const head = (
    <>
      <div>
        <h2>{title}</h2>
        {description ? <p className="dashboard-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </>
  );

  if (defaultCollapsed) {
    return (
      <details className={classes}>
        <summary className="section-head page-section-summary">{head}</summary>
        {children}
      </details>
    );
  }

  return (
    <section className={classes}>
      <div className="section-head">{head}</div>
      {children}
    </section>
  );
}
