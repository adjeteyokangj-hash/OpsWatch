import { describe, expect, it } from "vitest";
import { selectPlaybookKey } from "./automation-planner.service";

describe("automation-planner.service", () => {
  it("selects Redis cascade recovery when Redis is the root cause", () => {
    expect(
      selectPlaybookKey({
        failureClass: "CONNECTION_REFUSED",
        rootCauseName: "Redis",
        alertTitles: ["Redis unreachable"]
      })
    ).toBe("REDIS_CASCADE_RECOVERY");
  });

  it("selects HTTP investigation for status mismatch incidents", () => {
    expect(
      selectPlaybookKey({
        failureClass: "HTTP_STATUS_MISMATCH",
        rootCauseName: "Quote API",
        alertTitles: ["HTTP check mismatch"]
      })
    ).toBe("HTTP_CHECK_INVESTIGATION");
  });

  it("selects webhook recovery for webhook incidents", () => {
    expect(
      selectPlaybookKey({
        failureClass: "RELIABILITY",
        rootCauseName: "Webhook worker",
        alertTitles: ["Webhook delivery failed"]
      })
    ).toBe("WEBHOOK_DELIVERY_RECOVERY");
  });
});
