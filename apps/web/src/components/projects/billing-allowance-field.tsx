"use client";

import type { AllowanceFieldKey } from "../../lib/project-billing";
import { allowanceFieldLabel, isUnlimitedAllowance } from "../../lib/project-billing";

type Props = {
  field: AllowanceFieldKey;
  value: number | null;
  onChange: (value: number | null) => void;
};

export function BillingAllowanceField({ field, value, onChange }: Props) {
  const unlimited = isUnlimitedAllowance(value);

  return (
    <label>
      {allowanceFieldLabel[field]}
      <div className="billing-allowance-field">
        {unlimited ? (
          <input className="billing-allowance-field__display" disabled value="Unlimited" readOnly />
        ) : (
          <input
            type="number"
            min={1}
            value={value ?? ""}
            onChange={(event) => onChange(Number(event.target.value) || 1)}
          />
        )}
        <label className="billing-allowance-field__toggle">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(event) => {
              if (event.target.checked) {
                onChange(null);
                return;
              }
              onChange(field === "checkLimit" ? 50 : field === "userLimit" ? 5 : 100);
            }}
          />
          Unlimited
        </label>
      </div>
    </label>
  );
}
