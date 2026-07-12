import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageSection({ title, description, actions, children, className = "" }: Props) {
  return (
    <section className={`panel page-section ${className}`.trim()}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p className="dashboard-subtle">{description}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
