import { afterEach, describe, expect, it } from "vitest";
import {
  isPlatformSuperAdmin,
  platformSuperAdminEmails,
  requirePlatformSuperAdmin
} from "./require-platform-super-admin";
import type { AuthRequest } from "./auth";
import type { Response } from "express";

describe("require-platform-super-admin", () => {
  const original = process.env.PLATFORM_SUPER_ADMIN_EMAILS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLATFORM_SUPER_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_SUPER_ADMIN_EMAILS = original;
    }
  });

  it("normalizes comma-separated emails with whitespace and casing", () => {
    process.env.PLATFORM_SUPER_ADMIN_EMAILS = " Admin@OpsWatch.Local , other@example.com ";
    expect(platformSuperAdminEmails()).toEqual(["admin@opswatch.local", "other@example.com"]);
    expect(isPlatformSuperAdmin("ADMIN@OPSWATCH.LOCAL")).toBe(true);
    expect(isPlatformSuperAdmin("other@example.com")).toBe(true);
  });

  it("denies access when allowlist is empty or missing", () => {
    delete process.env.PLATFORM_SUPER_ADMIN_EMAILS;
    expect(platformSuperAdminEmails()).toEqual([]);
    expect(isPlatformSuperAdmin("admin@opswatch.local")).toBe(false);

    process.env.PLATFORM_SUPER_ADMIN_EMAILS = " , , ";
    expect(platformSuperAdminEmails()).toEqual([]);
    expect(isPlatformSuperAdmin("admin@opswatch.local")).toBe(false);
  });

  it("does not treat organization ADMIN role as platform super admin", () => {
    process.env.PLATFORM_SUPER_ADMIN_EMAILS = "platform-only@example.com";
    expect(isPlatformSuperAdmin("org-admin@example.com")).toBe(false);
  });

  it("returns 403 for authenticated non-allowlisted users", () => {
    process.env.PLATFORM_SUPER_ADMIN_EMAILS = "platform-only@example.com";
    const req = { user: { sub: "u1", email: "member@example.com", role: "ADMIN" } } as AuthRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      }
    } as Response & { statusCode: number; body: unknown };

    let nextCalled = false;
    requirePlatformSuperAdmin(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Platform super admin access required" });
  });

  it("returns 401 for unauthenticated requests", () => {
    process.env.PLATFORM_SUPER_ADMIN_EMAILS = "platform-only@example.com";
    const req = {} as AuthRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      }
    } as Response & { statusCode: number; body: unknown };

    let nextCalled = false;
    requirePlatformSuperAdmin(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
