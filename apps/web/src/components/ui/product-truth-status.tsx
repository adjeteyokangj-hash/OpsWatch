import { StatusBadge } from "./status-badge";

export const PRODUCT_TRUTH_STATES = [
  "Foundation",
  "Preview",
  "Draft",
  "Not configured",
  "Feature disabled",
  "Requires connection",
  "Test data",
  "Live verified"
] as const;

export type ProductTruthState = (typeof PRODUCT_TRUTH_STATES)[number];

const toneByState: Record<ProductTruthState, "success" | "warning" | "info" | "muted"> = {
  Foundation: "info",
  Preview: "warning",
  Draft: "muted",
  "Not configured": "muted",
  "Feature disabled": "muted",
  "Requires connection": "warning",
  "Test data": "warning",
  "Live verified": "success"
};

const labelByState: Partial<Record<ProductTruthState, string>> = {
  // Remediation Accuracy is currently the only user of this state. The missing
  // value means no verified outcomes exist yet, not that an operator forgot a setting.
  "Not configured": "Awaiting evidence"
};

export function ProductTruthStatus({
  state,
  detail
}: {
  state: ProductTruthState;
  detail?: string;
}) {
  return (
    <StatusBadge
      label={labelByState[state] ?? state}
      tone={toneByState[state]}
      title={detail}
    />
  );
}
