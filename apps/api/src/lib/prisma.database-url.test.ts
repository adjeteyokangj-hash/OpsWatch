import { afterEach, describe, expect, it } from "vitest";
import { buildDatabaseUrl } from "./prisma";

describe("buildDatabaseUrl", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = original;
    delete process.env.VERCEL;
  });

  it("appends pgbouncer=true for Supabase transaction pooler URLs", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    const url = buildDatabaseUrl();
    expect(url).toContain("pgbouncer=true");
    expect(url).toContain("connection_limit=");
  });

  it("does not duplicate pgbouncer=true when already present", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    const url = buildDatabaseUrl();
    expect(url.match(/pgbouncer=true/g)?.length).toBe(1);
  });

  it("leaves local postgres URLs unchanged aside from connection limits", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/opswatch?schema=public";
    const url = buildDatabaseUrl();
    expect(url).not.toContain("pgbouncer=true");
    expect(url).toContain("connection_limit=20");
  });

  it("uses a small multi-slot pool on Vercel so ticks and dashboard reads can share", () => {
    process.env.VERCEL = "1";
    process.env.DATABASE_URL =
      "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    expect(buildDatabaseUrl()).toContain("connection_limit=3");
  });

  it("lifts a historical connection_limit=1 on Vercel", () => {
    process.env.VERCEL = "1";
    process.env.DATABASE_URL =
      "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1";
    expect(buildDatabaseUrl()).toContain("connection_limit=3");
    expect(buildDatabaseUrl()).not.toMatch(/connection_limit=1(?!\d)/);
  });
});
