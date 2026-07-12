import Link from "next/link";
import type { ReactNode } from "react";

export type ActivityListItem = {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  href?: string;
};

export function ActivityList({ items }: { items: ActivityListItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="activity-feed">
      {items.map((item) => (
        <article className="activity-feed-item" key={item.id}>
          {item.badges ? <div className="activity-feed-head">{item.badges}</div> : null}
          {item.href ? (
            <Link className="activity-feed-title" href={item.href}>
              {item.title}
            </Link>
          ) : (
            <div className="activity-feed-title">{item.title}</div>
          )}
          {item.meta ? <p className="activity-feed-meta">{item.meta}</p> : null}
        </article>
      ))}
    </div>
  );
}
