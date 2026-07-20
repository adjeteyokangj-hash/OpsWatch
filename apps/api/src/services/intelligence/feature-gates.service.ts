/**
 * Phase 8 — centralized feature gates for learning / prediction / advanced capabilities.
 * Under safety_gated, paths stay OFF unless an env flag is exactly "true".
 * Under ai_led_safe, the documented safe set is on unless explicitly "false".
 */

import { resolveEffectiveEnvFlag } from "./ai-operating-profile.service";

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

export const listFeatureGates = (): FeatureGateStatus[] => [
  {
    key: "PREDICTIONS",
    envVar: "OPSWATCH_PREDICTIONS_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED"),
    defaultEnabled: false,
    description:
      "Evidence-backed prediction candidates (Phase 9). Still requires confidence thresholds."
  },
  {
    key: "LEARNED_TOPOLOGY",
    envVar: "OPSWATCH_LEARNED_TOPOLOGY_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_LEARNED_TOPOLOGY_ENABLED"),
    defaultEnabled: false,
    description: "Observation-driven learned relationship auto-creation"
  },
  {
    key: "OTEL_INGESTION",
    envVar: "OPSWATCH_OTEL_INGESTION_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_OTEL_INGESTION_ENABLED"),
    defaultEnabled: false,
    description: "OpenTelemetry collector ingest bridge"
  },
  {
    key: "AUTO_REPAIR",
    envVar: "OPSWATCH_AUTO_REPAIR_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_AUTO_REPAIR_ENABLED"),
    defaultEnabled: false,
    description: "Permit approval-gated high-impact repair actions"
  },
  {
    key: "ADVANCED_RCA",
    envVar: "OPSWATCH_ADVANCED_RCA_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_ADVANCED_RCA_ENABLED"),
    defaultEnabled: false,
    description: "Extra RCA overlays beyond evidence-ranked candidates"
  },
  {
    key: "AUTOMATION_TEST_MODE",
    envVar: "OPSWATCH_AUTOMATION_TEST_MODE",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_AUTOMATION_TEST_MODE"),
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
