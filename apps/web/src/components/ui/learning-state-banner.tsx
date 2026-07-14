import type { ReactNode } from "react";

type LearningState = "EMPTY" | "LEARNING" | "ACTIVE" | string;

export function LearningStateBanner({
  state,
  message,
  action
}: {
  state: LearningState;
  message?: string | null;
  action?: ReactNode;
}) {
  const tone =
    state === "ACTIVE" ? "learning-banner-active" : state === "LEARNING" ? "learning-banner-learning" : "learning-banner-empty";
  const title =
    state === "ACTIVE"
      ? "Intelligence active"
      : state === "LEARNING"
        ? "Building baselines"
        : "Waiting for operational evidence";

  return (
    <section className={`learning-banner ${tone}`} role="status">
      <div>
        <strong>{title}</strong>
        {message ? <p>{message}</p> : null}
      </div>
      {action ? <div className="learning-banner-action">{action}</div> : null}
    </section>
  );
}
