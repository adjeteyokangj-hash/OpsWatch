import { describe, expect, it } from "vitest";
import { classifyHttpCheckFailure } from "./failure-classification";

describe("failure-classification", () => {
  it("classifies expected 503 got 200 as HTTP status mismatch", () => {
    const row = classifyHttpCheckFailure({
      checkType: "HTTP",
      expectedStatusCode: 503,
      actualStatusCode: 200,
      message: "Expected 503 got 200"
    });

    expect(row.failureClass).toBe("HTTP_STATUS_MISMATCH");
    expect(row.diagnosis).toContain("responded successfully");
    expect(row.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies expected 200 got 500 as application error", () => {
    const row = classifyHttpCheckFailure({
      checkType: "HTTP",
      expectedStatusCode: 200,
      actualStatusCode: 500
    });

    expect(row.failureClass).toBe("APPLICATION_ERROR");
    expect(row.diagnosis).toContain("server errors");
  });

  it("classifies 401 responses as authentication failures", () => {
    const row = classifyHttpCheckFailure({
      checkType: "HTTP",
      expectedStatusCode: 200,
      actualStatusCode: 401
    });

    expect(row.failureClass).toBe("AUTHENTICATION");
  });

  it("classifies connection refused as network class", () => {
    const row = classifyHttpCheckFailure({
      error: Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })
    });

    expect(row.failureClass).toBe("CONNECTION_REFUSED");
  });
});
