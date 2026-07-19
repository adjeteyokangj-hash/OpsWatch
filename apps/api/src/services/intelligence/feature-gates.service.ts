/**
 * Phase 8 — centralized feature gates for learning / prediction / advanced capabilities.
 * All experimental emission paths default OFF unless an env flag is exactly "true".
 */

export type FeatureGateKey =
  | "PREDICTIONS"
  | "LEARNED_TOPOLOGY"
  | "OTEL_INGESTION"
  | "AUTO_REPAIR"
  | "ADVANCED_RCA"
  | "AUTOMATION_TEST_MODE";

export type FeatureGateStatus = {
  key: FeatureGateKey;
  envVar: string;
  enabled: boolean;
  defaultEnabled: false;
  description: string;
};

const envTrue = (name: string): boolean => process.env[name] === "true";

export const listFeatureGates = (): FeatureGateStatus[] => [
  {
    key: "PREDICTIONS",
    envVar: "OPSWATCH_PREDICTIONS_ENABLED",
    enabled: false,
    defaultEnabled: false,
    description: "Feature disabled until the Phase 9 learning and prediction gate is implemented"
  },
  {
    key: "LEARNED_TOPOLOGY",
    envVar: "OPSWATCH_LEARNED_TOPOLOGY_ENABLED",
    enabled: envTrue("OPSWATCH_LEARNED_TOPOLOGY_ENABLED"),
    defaultEnabled: false,
    description: "Observation-driven learned relationship auto-creation"
  },
  {
    key: "OTEL_INGESTION",
    envVar: "OPSWATCH_OTEL_INGESTION_ENABLED",
    enabled: envTrue("OPSWATCH_OTEL_INGESTION_ENABLED"),
    defaultEnabled: false,
    description: "OpenTelemetry collector ingest bridge"
  },
  {
    key: "AUTO_REPAIR",
    envVar: "OPSWATCH_AUTO_REPAIR_ENABLED",
    enabled: envTrue("OPSWATCH_AUTO_REPAIR_ENABLED"),
    defaultEnabled: false,
    description: "Permit approval-gated high-impact repair actions"
  },
  {
    key: "ADVANCED_RCA",
    envVar: "OPSWATCH_ADVANCED_RCA_ENABLED",
    enabled: envTrue("OPSWATCH_ADVANCED_RCA_ENABLED"),
    defaultEnabled: false,
    description: "Extra RCA overlays beyond evidence-ranked candidates"
  },
  {
    key: "AUTOMATION_TEST_MODE",
    envVar: "OPSWATCH_AUTOMATION_TEST_MODE",
    enabled: envTrue("OPSWATCH_AUTOMATION_TEST_MODE"),
    defaultEnabled: false,
    description: "Validate automation without mutating production systems"
  }
];

export const isFeatureGateEnabled = (key: FeatureGateKey): boolean =>
  listFeatureGates().some((gate) => gate.key === key && gate.enabled);

export const assertAllLearningGatesDefaultOff = (
  gates: FeatureGateStatus[] = listFeatureGates()
): { ok: boolean; enabled: FeatureGateKey[] } => {
  const enabled = gates.filter((g) => g.enabled).map((g) => g.key);
  return { ok: enabled.length === 0, enabled };
};
