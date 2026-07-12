"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COPY_RESET_MS = 2000;

export function useCopyFeedback() {
  const [label, setLabel] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flash = useCallback((successLabel: string) => {
    setLabel(successLabel);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setLabel(null);
      timerRef.current = null;
    }, COPY_RESET_MS);
  }, []);

  return { label, flash };
}

type CopyFeedbackButtonProps = {
  idleLabel: string;
  successLabel: string;
  onAction: () => void | Promise<void>;
  className?: string;
};

export function CopyFeedbackButton({
  idleLabel,
  successLabel,
  onAction,
  className = ""
}: CopyFeedbackButtonProps) {
  const { label, flash } = useCopyFeedback();
  const copied = label === successLabel;

  return (
    <button
      type="button"
      className={`secondary-button copy-feedback-button${copied ? " copy-feedback-button--success" : ""} ${className}`.trim()}
      onClick={() => void onAction().then(() => flash(successLabel))}
      data-action="local-ui"
    >
      {label ?? idleLabel}
    </button>
  );
}

type CredentialCopyFieldProps = {
  label: string;
  value: string;
  warning?: string;
  monospace?: boolean;
};

export function CredentialCopyField({ label, value, warning, monospace = true }: CredentialCopyFieldProps) {
  const copy = async () => {
    await navigator.clipboard.writeText(value);
  };

  return (
    <label>
      {label}
      <div className="api-key-copy-row">
        <input
          value={value}
          readOnly
          className={monospace ? "api-key-copy-input" : undefined}
        />
        <CopyFeedbackButton idleLabel="Copy" successLabel="✓ Copied" onAction={copy} className="api-key-copy-button" />
      </div>
      {warning ? <span className="warn-text api-key-once-warning">{warning}</span> : null}
    </label>
  );
}

const highlightEnvLine = (line: string): { key: string; value: string } | null => {
  const index = line.indexOf("=");
  if (index <= 0) return null;
  return { key: line.slice(0, index), value: line.slice(index + 1) };
};

export function EnvSnippetBlock({ snippet, onCopy }: { snippet: string; onCopy: () => void | Promise<void> }) {
  const lines = snippet.trim().split("\n").filter(Boolean);

  return (
    <div className="env-snippet-panel">
      <div className="env-snippet-head">
        <strong>Environment variables</strong>
        <CopyFeedbackButton idleLabel="Copy snippet" successLabel="✓ Copied" onAction={onCopy} />
      </div>
      <pre className="env-snippet-block">
        {lines.map((line) => {
          const parsed = highlightEnvLine(line);
          if (!parsed) {
            return (
              <code key={line} className="env-snippet-line">
                {line}
              </code>
            );
          }
          return (
            <code key={line} className="env-snippet-line">
              <span className="env-snippet-key">{parsed.key}</span>
              <span className="env-snippet-eq">=</span>
              <span className="env-snippet-value">{parsed.value}</span>
            </code>
          );
        })}
      </pre>
    </div>
  );
}

export function AuthenticationPanel() {
  return (
    <div className="register-auth-panel">
      <strong>Authentication</strong>
      <p className="register-auth-option register-auth-option--active">
        ✓ API key <span>(Recommended)</span>
      </p>
      <div className="register-auth-enterprise">
        <span className="register-auth-enterprise-label">Enterprise</span>
        <p>mTLS authentication</p>
        <p className="field-hint">Available on Enterprise plans</p>
      </div>
    </div>
  );
}
