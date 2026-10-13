export function IntelligencePipeline() {
  return (
    <div className="ow-pipeline" aria-hidden="true">
      <div className="ow-pipeline-stage">
        <div className="ow-pipeline-icon ow-pipeline-icon--detect">◉</div>
        <strong>Monitor</strong>
        <span>URL, SSL, heartbeat and topology signals</span>
        <ul>
          <li>Checkout API · 142 ms</li>
          <li>Admin portal · healthy</li>
          <li>Quote workflow · elevated</li>
        </ul>
      </div>
      <div className="ow-pipeline-arrow" />
      <div className="ow-pipeline-stage">
        <div className="ow-pipeline-icon ow-pipeline-icon--analyse">◈</div>
        <strong>Analyse</strong>
        <span>Correlate failures into incident context</span>
        <ul>
          <li>Blast radius: Pricing Engine</li>
          <li>Confidence: 86%</li>
          <li>Evidence: check + topology</li>
        </ul>
      </div>
      <div className="ow-pipeline-arrow" />
      <div className="ow-pipeline-stage">
        <div className="ow-pipeline-icon ow-pipeline-icon--predict">◎</div>
        <strong>Learn</strong>
        <span>Baselines and patterns (predictions gated)</span>
        <ul>
          <li>Baseline samples ready</li>
          <li>Recurring sequence preview</li>
          <li>Predictions: not live</li>
        </ul>
      </div>
      <div className="ow-pipeline-arrow" />
      <div className="ow-pipeline-stage">
        <div className="ow-pipeline-icon ow-pipeline-icon--recover">↺</div>
        <strong>Recover</strong>
        <span>Suggested or approved remediation</span>
        <ul>
          <li>Action: restart sync worker</li>
          <li>Policy: approval required</li>
          <li>Verify recovery after run</li>
        </ul>
      </div>
    </div>
  );
}

export function MonitoringVisual() {
  return (
    <div className="ow-monitor-visual" aria-hidden="true">
      <div className="ow-monitor-ring">
        <strong>12</strong>
        <span>apps watched</span>
      </div>
      <div className="ow-monitor-stack">
        <div className="ow-monitor-row is-ok">
          <span className="ow-dot ow-dot--ok" />
          Public site
          <em>200 · 118 ms</em>
        </div>
        <div className="ow-monitor-row is-ok">
          <span className="ow-dot ow-dot--ok" />
          SSL certificate
          <em>valid · 64d</em>
        </div>
        <div className="ow-monitor-row is-warn">
          <span className="ow-dot ow-dot--warn" />
          Admin URL
          <em>latency high</em>
        </div>
        <div className="ow-monitor-row is-ok">
          <span className="ow-dot ow-dot--ok" />
          Heartbeat
          <em>fresh</em>
        </div>
      </div>
    </div>
  );
}

export function RecoveryVisual() {
  return (
    <div className="ow-recovery-visual" aria-hidden="true">
      <ol className="ow-recovery-steps">
        <li className="is-done">
          <span>1</span>
          <div>
            <strong>Detect</strong>
            <p>Heartbeat stale on sync worker</p>
          </div>
        </li>
        <li className="is-done">
          <span>2</span>
          <div>
            <strong>Propose</strong>
            <p>Suggest restart_sync_worker</p>
          </div>
        </li>
        <li className="is-active">
          <span>3</span>
          <div>
            <strong>Approve</strong>
            <p>Operator confirms within policy</p>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <strong>Verify</strong>
            <p>Re-check health and close alert</p>
          </div>
        </li>
      </ol>
    </div>
  );
}
