import Link from "next/link";

const INTEGRATIONS = [
  {
    title: "Agentless HTTP / API",
    state: "Live",
    body: "Probe public endpoints and keep health current without installing an agent."
  },
  {
    title: "Heartbeat ingest",
    state: "Live",
    body: "Signed heartbeats detect silence and recovery for connected applications."
  },
  {
    title: "Webhooks",
    state: "Live",
    body: "Receive signed operational events into the alert and incident spine."
  },
  {
    title: "OpenTelemetry",
    state: "Live",
    body: "Normalize OTEL signals that enrich alerts, incidents and topology freshness."
  },
  {
    title: "SDK ingest",
    state: "Live",
    body: "Use @opswatch/client with project API key and signing secret."
  },
  {
    title: "Advanced Observability Integrations",
    state: "Available",
    body: "Connect supported monitoring and telemetry sources to bring application health, performance signals and dependency information into OpsWatch."
  }
] as const;

export function IntegrationsShowcase() {
  return (
    <div className="ow-integrations-grid">
      {INTEGRATIONS.map((item) => (
        <article key={item.title} className="ow-integration-card">
          <div className="ow-integration-card-top">
            <span className="ow-integration-glyph" aria-hidden="true">
              {item.title.slice(0, 1)}
            </span>
            <span className={`ow-state ow-state--${item.state.toLowerCase().replace(" ", "-")}`}>
              {item.state}
            </span>
          </div>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>
      ))}
      <div className="ow-integrations-cta">
        <Link href="/integrations" className="ow-btn ow-btn-primary">
          View all integrations
        </Link>
      </div>
    </div>
  );
}
