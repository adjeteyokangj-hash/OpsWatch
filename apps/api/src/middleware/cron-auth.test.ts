import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { constantTimeEqual, requireCronSecret } from "./cron-auth";

const makeReqRes = (authorization?: string) => {
  const req = {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined)
  } as unknown as Request;

  const json = vi.fn();
  const status = vi.fn(() => ({ json })) as unknown as Response["status"];
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next, status, json };
};

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("secret-value", "secret-value")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("secret-value", "secret-xalue")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
  });
});

describe("requireCronSecret", () => {
  const previous = process.env.OPSWATCH_CRON_SECRET;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPSWATCH_CRON_SECRET;
    } else {
      process.env.OPSWATCH_CRON_SECRET = previous;
    }
    vi.restoreAllMocks();
  });

  it("rejects with 401 when the server secret is not configured (fails closed)", () => {
    delete process.env.OPSWATCH_CRON_SECRET;
    const { req, res, next, status } = makeReqRes("Bearer anything");
    requireCronSecret(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the Authorization header is missing", () => {
    process.env.OPSWATCH_CRON_SECRET = "top-secret";
    const { req, res, next, status } = makeReqRes(undefined);
    requireCronSecret(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the bearer token is incorrect", () => {
    process.env.OPSWATCH_CRON_SECRET = "top-secret";
    const { req, res, next, status } = makeReqRes("Bearer wrong-secret");
    requireCronSecret(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a non-bearer Authorization scheme", () => {
    process.env.OPSWATCH_CRON_SECRET = "top-secret";
    const { req, res, next, status } = makeReqRes("Basic top-secret");
    requireCronSecret(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the bearer token matches", () => {
    process.env.OPSWATCH_CRON_SECRET = "top-secret";
    const { req, res, next, status } = makeReqRes("Bearer top-secret");
    requireCronSecret(req, res, next);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("tolerates surrounding whitespace and mixed-case scheme", () => {
    process.env.OPSWATCH_CRON_SECRET = "top-secret";
    const { req, res, next } = makeReqRes("  bearer   top-secret  ");
    requireCronSecret(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
