/**
 * Explicit AI operating profile for release configuration.
 *
 * - safety_gated (default when unset): all advanced AI flags stay opt-in (=== "true").
 * - ai_led_safe: profile turns the documented safe-AI flag set on unless an individual
 *   flag is explicitly set to "false" (escape hatch).
 *
 * Confidence / evidence gates still apply when flags are on.
 */

export type AiOperatingProfile = "safety_gated" | "ai_led_safe";

/** Flags the ai_led_safe profile enables by default (explicit false still wins). */
export const AI_LED_SAFE_FLAG_DEFAULTS = [
  "OPSWATCH_PREDICTIONS_ENABLED",
  "OPSWATCH_LEARNING_BASELINES_ENABLED",
  "OPSWATCH_LEARNING_ANOMALIES_ENABLED",
  "OPSWATCH_LEARNING_INCIDENT_MATCHING_ENABLED",
  "OPSWATCH_PREVENTIVE_RECOMMENDATIONS_ENABLED",
  "OPSWATCH_LEARNED_TOPOLOGY_ENABLED",
  "OPSWATCH_ADVANCED_RCA_ENABLED",
  "OPSWATCH_AUTO_REPAIR_ENABLED",
  "AUTO_HEAL_DEFAULT_ENABLED"
] as const;

export type AiLedSafeFlagName = (typeof AI_LED_SAFE_FLAG_DEFAULTS)[number];

const AI_LED_SAFE_FLAG_SET = new Set<string>(AI_LED_SAFE_FLAG_DEFAULTS);

export const resolveAiOperatingProfile = (
  raw: string | undefined = process.env.OPSWATCH_AI_OPERATING_PROFILE
): AiOperatingProfile => {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "ai_led_safe" || value === "ai-led-safe") return "ai_led_safe";
  return "safety_gated";
};

/**
 * Effective boolean for an env flag under the active profile.
 * - Explicit "false" always disables.
 * - Explicit "true" always enables.
 * - Unset: enabled only when profile is ai_led_safe and the flag is in the safe set.
 */
export const resolveEffectiveEnvFlag = (
  envVar: string,
  opts: { profile?: AiOperatingProfile; env?: NodeJS.ProcessEnv } = {}
): boolean => {
  const env = opts.env ?? process.env;
  const profile = opts.profile ?? resolveAiOperatingProfile(env.OPSWATCH_AI_OPERATING_PROFILE);
  const raw = env[envVar];
  if (raw === "false") return false;
  if (raw === "true") return true;
  if (profile === "ai_led_safe" && AI_LED_SAFE_FLAG_SET.has(envVar)) return true;
  return false;
};

export type AiOperatingProfileSnapshot = {
  profile: AiOperatingProfile;
  envVar: "OPSWATCH_AI_OPERATING_PROFILE";
  description: string;
  effectiveFlags: Array<{
    envVar: string;
    enabled: boolean;
    profileDefault: boolean;
    explicitOverride: "true" | "false" | null;
  }>;
};

export const getAiOperatingProfileSnapshot = (
  env: NodeJS.ProcessEnv = process.env
): AiOperatingProfileSnapshot => {
  const profile = resolveAiOperatingProfile(env.OPSWATCH_AI_OPERATING_PROFILE);
  const effectiveFlags = AI_LED_SAFE_FLAG_DEFAULTS.map((envVar) => {
    const raw = env[envVar];
    const explicitOverride: "true" | "false" | null =
      raw === "true" || raw === "false" ? raw : null;
    return {
      envVar,
      enabled: resolveEffectiveEnvFlag(envVar, { profile, env }),
      profileDefault: profile === "ai_led_safe",
      explicitOverride
    };
  });

  return {
    profile,
    envVar: "OPSWATCH_AI_OPERATING_PROFILE",
    description:
      profile === "ai_led_safe"
        ? "AI leads routine operations; governance bounds high-impact and emergency stop."
        : "Safety-gated development mode — advanced AI capabilities stay opt-in.",
    effectiveFlags
  };
};