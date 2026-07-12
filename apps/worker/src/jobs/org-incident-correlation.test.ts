import { describe, expect, it } from "vitest";
import { extractCorrelationKey } from "./org-incident-correlation";

describe("org-incident-correlation", () => {
  it("extracts shared infrastructure correlation keys", () => {
    expect(
      extractCorrelationKey({
        alertTitles: ["Redis unreachable"],
        alertMessages: ["[CONNECTION_REFUSED] cache unavailable"],
        serviceNames: ["Redis"]
      })
    ).toBe("infra:redis");
  });

  it("falls back to service name signature", () => {
    expect(
      extractCorrelationKey({
        alertTitles: ["Quote API failing"],
        alertMessages: ["application error"],
        serviceNames: ["Quote API"]
      })
    ).toBe("service:quote-api");
  });
});
