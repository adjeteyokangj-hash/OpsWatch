import { describe, expect, it } from "vitest";
import { topologyImportUsesSessionConnection } from "./connection-topology-discovery.service";

describe("topology import transaction target", () => {
  it("uses the session connection when the application URL is the transaction pooler", () => {
    expect(
      topologyImportUsesSessionConnection(
        "postgresql://user@pooler.supabase.com:6543/postgres?pgbouncer=true",
        "postgresql://user@pooler.supabase.com:5432/postgres"
      )
    ).toBe(true);
  });

  it("keeps a normal local connection on the shared client", () => {
    expect(
      topologyImportUsesSessionConnection(
        "postgresql://user@localhost:5432/opswatch",
        "postgresql://user@localhost:5432/opswatch"
      )
    ).toBe(false);
  });

  it("does not treat another transaction-pooler URL as a session connection", () => {
    expect(
      topologyImportUsesSessionConnection(
        "postgresql://user@pooler.supabase.com:6543/postgres",
        "postgresql://user@pooler.supabase.com:6543/postgres?pgbouncer=true"
      )
    ).toBe(false);
  });
});
