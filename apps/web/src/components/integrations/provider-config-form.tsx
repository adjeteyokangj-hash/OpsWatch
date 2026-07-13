"use client";

import { useState } from "react";
import {
  allProviderFields,
  isFieldPresent,
  maskSecretValue,
  PROVIDER_FIELD_GROUPS,
  type IntegrationType,
  type ProviderField
} from "../../lib/integrations";

type SecretFieldInputProps = {
  field: ProviderField;
  value: string;
  onChange: (value: string) => void;
};

const SecretFieldInput = ({ field, value, onChange }: SecretFieldInputProps) => {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(!value);

  const displayValue = editing ? value : value ? maskSecretValue(value) : "";

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onChange(text.trim());
        setEditing(true);
        setRevealed(true);
      }
    } catch {
      setEditing(true);
      setRevealed(true);
    }
  };

  return (
    <label className="provider-field provider-field--secret">
      <span className="provider-field__label">{field.label}</span>
      <div className="provider-field__secret-row">
        <input
          type={revealed ? "text" : "password"}
          value={displayValue}
          placeholder={field.placeholder}
          onFocus={() => {
            setEditing(true);
            setRevealed(true);
          }}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
        <button type="button" className="secondary-button" onClick={() => void pasteFromClipboard()}>
          Paste
        </button>
      </div>
    </label>
  );
};

type ProviderFieldInputProps = {
  field: ProviderField;
  value: string;
  onChange: (value: string) => void;
};

const ProviderFieldInput = ({ field, value, onChange }: ProviderFieldInputProps) => {
  if (field.kind === "secret") {
    return <SecretFieldInput field={field} value={value} onChange={onChange} />;
  }

  return (
    <label className="provider-field">
      <span className="provider-field__label">{field.label}</span>
      <input
        type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"}
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
};

type RequiredFieldsChecklistProps = {
  type: IntegrationType;
  config: Record<string, unknown>;
};

export const RequiredFieldsChecklist = ({ type, config }: RequiredFieldsChecklistProps) => {
  const fields = allProviderFields(type).filter((field) => field.required || field.recommended);
  if (fields.length === 0) return null;

  return (
    <div className="required-fields-card">
      <h3>Required</h3>
      <ul className="required-fields-list">
        {fields.map((field) => {
          const present = isFieldPresent(config, field);
          const status = present ? "pass" : field.required ? "fail" : "warn";
          return (
            <li key={field.key} className={`required-fields-item required-fields-item--${status}`}>
              <span aria-hidden="true">{present ? "✓" : "✗"}</span>
              <span>
                {field.label}
                {!field.required ? <span className="table-subtle"> (recommended)</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

type ProviderConfigFormProps = {
  type: IntegrationType;
  enabled: boolean;
  name: string;
  secretRef: string;
  configJson: Record<string, unknown>;
  showAdvanced: boolean;
  advancedJson: string;
  onEnabledChange: (enabled: boolean) => void;
  onNameChange: (name: string) => void;
  onSecretRefChange: (secretRef: string) => void;
  onConfigValueChange: (key: string, value: string) => void;
  onAdvancedJsonChange: (value: string) => void;
  onToggleAdvanced: () => void;
};

export const ProviderConfigForm = ({
  type,
  enabled,
  name,
  secretRef,
  configJson,
  showAdvanced,
  advancedJson,
  onEnabledChange,
  onNameChange,
  onSecretRefChange,
  onConfigValueChange,
  onAdvancedJsonChange,
  onToggleAdvanced
}: ProviderConfigFormProps) => {
  const { credentials, configuration } = PROVIDER_FIELD_GROUPS[type];

  const renderFields = (fields: ProviderField[]) =>
    fields.map((field) => (
      <ProviderFieldInput
        key={field.key}
        field={field}
        value={String(configJson[field.key] ?? field.defaultValue ?? "")}
        onChange={(value) => onConfigValueChange(field.key, value)}
      />
    ));

  return (
    <div className="provider-config-form stack-form">
      <label className="checkbox-row">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        Enabled
      </label>

      <label>
        Display name
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={`${type.toLowerCase()} integration`}
        />
      </label>

      <RequiredFieldsChecklist type={type} config={configJson} />

      {credentials.length > 0 ? (
        <section className="provider-section">
          <div className="provider-section__head">
            <h3>Credentials</h3>
            <p>Paste provider secrets here. Values are stored securely for this project.</p>
          </div>
          {renderFields(credentials)}
        </section>
      ) : null}

      {configuration.length > 0 ? (
        <section className="provider-section">
          <div className="provider-section__head">
            <h3>{credentials.length > 0 ? "Provider configuration" : "Connection settings"}</h3>
            <p>Non-secret settings used to reach and identify this provider.</p>
          </div>
          {renderFields(configuration)}
        </section>
      ) : null}

      <section className="provider-section provider-section--advanced">
        <button type="button" className="advanced-toggle" onClick={onToggleAdvanced}>
          Advanced configuration {showAdvanced ? "▲" : "▼"}
        </button>
        {showAdvanced ? (
          <div className="advanced-panel">
            <label>
              Secret reference
              <input
                value={secretRef}
                onChange={(event) => onSecretRefChange(event.target.value)}
                placeholder="vault://opswatch/project/provider"
              />
              <span className="table-subtle">Optional external vault pointer for operators managing secrets outside OpsWatch.</span>
            </label>
            <label>
              Raw JSON
              <textarea rows={8} value={advancedJson} onChange={(event) => onAdvancedJsonChange(event.target.value)} />
              <span className="table-subtle">Power users can edit the full provider payload when needed.</span>
            </label>
          </div>
        ) : null}
      </section>
    </div>
  );
};
