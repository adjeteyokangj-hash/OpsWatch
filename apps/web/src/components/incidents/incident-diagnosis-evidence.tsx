import type { DiagnosisResult } from "./incident-diagnosis-types";

type Props = {
  diagnosis: DiagnosisResult;
};

export function IncidentDiagnosisEvidence({ diagnosis }: Props) {
  const rootName = diagnosis.dependencyImpact?.probableRootCause?.serviceName;
  const reasons = diagnosis.diagnosisReasons ?? [];
  const hasContent = Boolean(rootName) || reasons.length > 0 || (diagnosis.evidence?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <section className="panel incident-evidence-panel">
      <h2>Why OpsWatch selected {rootName ?? "this root cause"}</h2>
      {reasons.length > 0 ? (
        <ul className="diagnosis-reason-list">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {diagnosis.evidence && diagnosis.evidence.length > 0 ? (
        <div className="incident-evidence-signals">
          <p className="metric-label">Correlated signals</p>
          <ul className="diagnosis-reason-list">
            {diagnosis.evidence.map((item, index) => (
              <li key={`${item.type}-${index}`}>
                <span className="dashboard-subtle">{item.type.replace(/_/g, " ")}:</span> {item.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diagnosis.dependencyImpact?.narrative ? (
        <p className="dashboard-subtle incident-evidence-narrative">{diagnosis.dependencyImpact.narrative}</p>
      ) : null}
    </section>
  );
}
