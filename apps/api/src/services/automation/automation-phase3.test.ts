import { describe, expect, it } from "vitest";
import { AUTONOMOUS_PLAYBOOK_ACTIONS, isPlaybookAutonomousEligible } from "./automation-safeguards.service";
import { selectPlaybookWithLlm } from "./automation-llm-planner.service";

describe("automation-safeguards.service", () => {
  it("allows autonomous playbooks with only low-risk steps", () => {
    expect(
      isPlaybookAutonomousEligible([
        { action: "RERUN_CHECK", approvalRequired: false },
        { action: "VERIFY_SERVICE", approvalRequired: false }
      ])
    ).toBe(true);
    expect(
      isPlaybookAutonomousEligible([
        { action: "RERUN_CHECK", approvalRequired: false },
        { action: "REVIEW_HTTP_EXPECTED_STATUS", approvalRequired: true }
      ])
    ).toBe(false);
  });

  it("defines autonomous action allowlist", () => {
    expect(AUTONOMOUS_PLAYBOOK_ACTIONS.has("RETRY_WEBHOOKS")).toBe(true);
    expect(AUTONOMOUS_PLAYBOOK_ACTIONS.has("REVIEW_HTTP_EXPECTED_STATUS")).toBe(false);
  });
});

describe("automation-llm-planner.service", () => {
  it("falls back to rules when LLM planner is disabled", async () => {
    const previous = process.env.AUTOMATION_LLM_PLANNER_ENABLED;
    process.env.AUTOMATION_LLM_PLANNER_ENABLED = "false";
    const result = await selectPlaybookWithLlm({
      failureClass: "HTTP_STATUS_MISMATCH",
      alertTitles: ["HTTP mismatch"],
      diagnosis: "HTTP status mismatch detected."
    });
    process.env.AUTOMATION_LLM_PLANNER_ENABLED = previous;
    expect(result.playbookKey).toBe("HTTP_CHECK_INVESTIGATION");
    expect(result.analysisMode).toBe("RULES");
  });
});
