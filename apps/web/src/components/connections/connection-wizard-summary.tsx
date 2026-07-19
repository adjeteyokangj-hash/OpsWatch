"use client";

import {
  authTypeLabel,
  hostFromBaseUrl,
  isRestMethod,
  methodLabel,
  resolveTimeoutMs
} from "./connection-form-state";
import type { GuidedConnectionForm, ProjectOption } from "./types";

type ConnectionWizardSummaryProps = {
  form: GuidedConnectionForm;
  projects: ProjectOption[];
  step: number;
  testSucceeded: boolean;
};

export function ConnectionWizardSummary({
  form,
  projects,
  step,
  testSucceeded
}: ConnectionWizardSummaryProps) {
  const project = projects.find((row) => row.id === form.applicationId);
  const steps = ["Details", "Configuration", "Test and save"];

  return (
    <aside className="connection-wizard-summary" aria-label="Connection summary">
      <h3>Summary</h3>
      <ol className="connection-wizard-summary__steps">
        {steps.map((label, index) => {
          const number = index + 1;
          const status = number < step ? "done" : number === step ? "current" : "upcoming";
          return (
            <li key={label} className={`connection-wizard-summary__step connection-wizard-summary__step--${status}`}>
              <span>{number}</span>
              {label}
            </li>
          );
        })}
      </ol>
      <dl className="connection-wizard-summary__facts">
        <div>
          <dt>Application</dt>
          <dd>{project?.name ?? "Select an application"}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>{form.name.trim() || "Untitled"}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{form.environment}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{methodLabel(form.method)}</dd>
        </div>
        {isRestMethod(form.method) ? (
          <>
            <div>
              <dt>Host</dt>
              <dd>{hostFromBaseUrl(form.baseUrl) || "—"}</dd>
            </div>
            <div>
              <dt>Health path</dt>
              <dd>{form.healthPath || "—"}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Authentication</dt>
          <dd>{authTypeLabel(form.authType)}</dd>
        </div>
        <div>
          <dt>Timeout</dt>
          <dd>{resolveTimeoutMs(form)} ms</dd>
        </div>
        <div>
          <dt>Test status</dt>
          <dd>{testSucceeded ? "Passed" : "Not verified"}</dd>
        </div>
      </dl>
    </aside>
  );
}
