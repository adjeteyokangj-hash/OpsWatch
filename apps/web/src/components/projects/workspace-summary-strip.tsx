type MetricCard = {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "healthy" | "degraded" | "critical" | "neutral" | "info";
};

export function WorkspaceSummaryStrip({ cards }: { cards: MetricCard[] }) {
  return (
    <section className="workspace-summary-strip">
      {cards.map((card) => (
        <article className={`workspace-summary-card tone-${card.tone ?? "neutral"}`} key={card.key}>
          <span className="workspace-summary-label">{card.label}</span>
          <strong className="workspace-summary-value">{card.value}</strong>
          {card.hint ? <span className="workspace-summary-hint">{card.hint}</span> : null}
        </article>
      ))}
    </section>
  );
}
