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
    expect(url).toContain("connection_limit=5");
  });
});
