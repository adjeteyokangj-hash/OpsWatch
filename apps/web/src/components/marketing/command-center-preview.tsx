export function CommandCenterPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ow-preview${compact ? " ow-preview--compact" : ""}`} aria-hidden="true">
      <div className="ow-preview-chrome">
        <span />
        <span />
        <span />
        <strong>Command Center</strong>
      </div>
      <div className="ow-preview-body">
        <aside className="ow-preview-side">
          <div className="ow-preview-side-item is-active">Dashboard</div>
          <div className="ow-preview-side-item">Applications</div>
          <div className="ow-preview-side-item">Incidents</div>
          <div className="ow-preview-side-item">Topology</div>
        </aside>
        <div className="ow-preview-main">
          <div className="ow-preview-kpis">
            <div className="ow-preview-kpi">
              <span>Healthy</span>
              <strong>12</strong>
            </div>
            <div className="ow-preview-kpi ow-preview-kpi--warn">
              <span>Degraded</span>
              <strong>2</strong>
            </div>
            <div className="ow-preview-kpi ow-preview-kpi--down">
              <span>Down</span>
              <strong>1</strong>
            </div>
            <div className="ow-preview-kpi ow-preview-kpi--ok">
              <span>Checks</span>
              <strong>148</strong>
            </div>
          </div>
          <div className="ow-preview-panels">
            <div className="ow-preview-panel">
              <header>
                <span className="ow-dot ow-dot--ok" />
                Checkout API
              </header>
              <div className="ow-spark">
                <i style={{ height: "38%" }} />
                <i style={{ height: "52%" }} />
                <i style={{ height: "46%" }} />
                <i style={{ height: "64%" }} />
                <i style={{ height: "58%" }} />
                <i style={{ height: "71%" }} />
                <i style={{ height: "66%" }} />
              </div>
            </div>
            <div className="ow-preview-panel">
              <header>
                <span className="ow-dot ow-dot--warn" />
                Quote workflow
              </header>
              <ul>
                <li>Latency elevated</li>
                <li>Dependency: Pricing Engine</li>
                <li>Suggested restart candidate</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
