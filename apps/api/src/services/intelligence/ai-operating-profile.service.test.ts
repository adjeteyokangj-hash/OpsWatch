import { afterEach, describe, expect, it } from "vitest";
import {
  getAiOperatingProfileSnapshot,
  resolveAiOperatingProfile,
  resolveEffectiveEnvFlag
} from "./ai-operating-profile.service";

const clearProfileEnv = () => {
  delete process.env.OPSWATCH_AI_OPERATING_PROFILE;
  delete process.env.OPSWATCH_PREDICTIONS_ENABLED;
  delete process.env.OPSWATCH_LEARNING_BASELINES_ENABLED;
  delete process.env.OPSWATCH_AUTO_REPAIR_ENABLED;
  delete process.env.AUTO_HEAL_DEFAULT_ENABLED;
};

afterEach(() => {
  clearProfileEnv();
});

describe("ai-operating-profile", () => {
  it("defaults to safety_gated when unset", () => {
    clearProfileEnv();
    expect(resolveAiOperatingProfile()).toBe("safety_gated");
    expect(resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED")).toBe(false);
  });

  it("enables safe flags under ai_led_safe when unset", () => {
    process.env.OPSWATCH_AI_OPERATING_PROFILE = "ai_led_safe";
    expect(resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED")).toBe(true);
    expect(resolveEffectiveEnvFlag("OPSWATCH_AUTO_REPAIR_ENABLED")).toBe(true);
    expect(resolveEffectiveEnvFlag("AUTO_HEAL_DEFAULT_ENABLED")).toBe(true);
    expect(resolveEffectiveEnvFlag("OPSWATCH_PREDICTION_NOTIFICATIONS_ENABLED")).toBe(false);
  });

  it("lets explicit false override the profile", () => {
    process.env.OPSWATCH_AI_OPERATING_PROFILE = "ai_led_safe";
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "false";
    expect(resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED")).toBe(false);
    expect(resolveEffectiveEnvFlag("OPSWATCH_LEARNED_TOPOLOGY_ENABLED")).toBe(true);
  });

  it("lets explicit true enable under safety_gated", () => {
    process.env.OPSWATCH_AI_OPERATING_PROFILE = "safety_gated";
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "true";
    expect(resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED")).toBe(true);
  });

  it("snapshots profile and effective flags", () => {
    process.env.OPSWATCH_AI_OPERATING_PROFILE = "ai_led_safe";
    process.env.OPSWATCH_AUTO_REPAIR_ENABLED = "false";
    const snap = getAiOperatingProfileSnapshot();
    expect(snap.profile).toBe("ai_led_safe");
    const repair = snap.effectiveFlags.find((row) => row.envVar === "OPSWATCH_AUTO_REPAIR_ENABLED");
    expect(repair?.enabled).toBe(false);
    expect(repair?.explicitOverride).toBe("false");
  });
});