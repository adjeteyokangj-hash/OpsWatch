import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_RATE_LIMIT_BYPASS_HEADER,
  isProductionLikeEnvironment,
  maxRequestsPerWindow,
  rateLimit,
  resetRateLimitBucketsForTests,
  shouldRelaxAuthRateLimit
} from "./rate-limit";

describe("rate-limit production guards", () => {
  afterEach(() => {
    resetRateLimitBucketsForTests();
    delete process.env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT;
    delete process.env.OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS;
    delete process.env.OPSWATCH_RELAX_RATE_LIMIT;
    delete process.env.VERCEL_ENV;
  });

  it("treats NODE_ENV=production and VERCEL_ENV=production as production-like", () => {
    expect(isProductionLikeEnvironment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionLikeEnvironment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionLikeEnvironment({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionLikeEnvironment({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("refuses E2E env bypass in production", () => {
    expect(
      shouldRelaxAuthRateLimit(
        { headers: {} },
        {
          NODE_ENV: "production",
          OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT: "true"
        }
      )
    ).toBe(false);
  });

  it("refuses trusted header bypass in production even when allow flag is set", () => {
    expect(
      shouldRelaxAuthRateLimit(
        { headers: { [E2E_RATE_LIMIT_BYPASS_HEADER]: "1" } },
        {
          NODE_ENV: "production",
          OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS: "true"
        }
      )
    ).toBe(false);
    expect(
      shouldRelaxAuthRateLimit(
        { headers: { [E2E_RATE_LIMIT_BYPASS_HEADER]: "1" } },
        {
          VERCEL_ENV: "production",
          NODE_ENV: "development",
          OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS: "true"
        }
      )
    ).toBe(false);
  });

  it("allows process-wide E2E relax only in non-production", () => {
    expect(
      shouldRelaxAuthRateLimit(
        { headers: {} },
        {
          NODE_ENV: "development",
          OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT: "true"
        }
      )
    ).toBe(true);
  });

  it("allows header bypass only when non-prod + allow flag", () => {
    expect(
      shouldRelaxAuthRateLimit(
        { headers: { [E2E_RATE_LIMIT_BYPASS_HEADER]: "true" } },
        {
          NODE_ENV: "test",
          OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS: "true"
        }
      )
    ).toBe(true);
    expect(
      shouldRelaxAuthRateLimit(
        { headers: { [E2E_RATE_LIMIT_BYPASS_HEADER]: "1" } },
        { NODE_ENV: "test" }
      )
    ).toBe(false);
  });

  it("keeps production max at 200 even if relax envs are set", () => {
    expect(
      maxRequestsPerWindow({
        NODE_ENV: "production",
        OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT: "true",
        OPSWATCH_RELAX_RATE_LIMIT: "true"
      })
    ).toBe(200);
  });

  it("middleware next() immediately when E2E env relax is active", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousE2e = process.env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT;
    process.env.NODE_ENV = "development";
    process.env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT = "true";
    let nextCalled = false;
    let statusCode = 0;
    rateLimit(
      { ip: "203.0.113.50", headers: {} },
      {
        status(code: number) {
          statusCode = code;
          return { json() {} };
        }
      },
      () => {
        nextCalled = true;
      }
    );
    expect(nextCalled).toBe(true);
    expect(statusCode).toBe(0);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousE2e === undefined) delete process.env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT;
    else process.env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT = previousE2e;
  });
});
