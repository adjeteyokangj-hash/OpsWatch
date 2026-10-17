import { afterEach, describe, expect, it, vi } from "vitest";
import { hashMonitoringTicket } from "./user-monitoring";
import { redeemNiinaiMonitoringTicket } from "./niinai-ticket-redeem";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TICKET = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";

describe("NiiNai monitoring ticket redemption", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the monitoring connection is not configured", async () => {
    const result = await redeemNiinaiMonitoringTicket(TICKET, { env: {} });
    expect(result).toBeNull();
  });

  it("sends the ticket hash and returns the proven user", async () => {
    const redeem = vi.fn(async () => OWNER);
    const result = await redeemNiinaiMonitoringTicket(TICKET, {
      env: { NIINAI_MONITORING_DATABASE_URL: "postgresql://niinai_monitoring:secret-value@db.example/postgres" },
      redeem
    });
    expect(result).toBe(OWNER);
    expect(redeem).toHaveBeenCalledOnce();
    expect(redeem.mock.calls[0]?.[0]).toBe(hashMonitoringTicket(TICKET));
    expect(redeem.mock.calls[0]?.[0]).not.toBe(TICKET);
    expect(JSON.stringify(redeem.mock.calls)).not.toContain(TICKET);
  });

  it("rejects an access token and a second empty redemption", async () => {
    const redeem = vi.fn(async () => null);
    expect(await redeemNiinaiMonitoringTicket("header.payload.signature", { redeem })).toBeNull();
    expect(
      await redeemNiinaiMonitoringTicket(TICKET, {
        env: { NIINAI_MONITORING_DATABASE_URL: "postgresql://local" },
        redeem
      })
    ).toBeNull();
    expect(redeem).toHaveBeenCalledOnce();
  });

  it("hides the monitoring connection when redemption fails", async () => {
    const secret = "postgresql://niinai_monitoring:secret-value@db.example/postgres";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await redeemNiinaiMonitoringTicket(TICKET, {
      env: { NIINAI_MONITORING_DATABASE_URL: secret },
      redeem: async () => {
        throw new Error(`connect failed for ${secret}`);
      }
    });
    expect(result).toBeNull();
    expect(error.mock.calls.flat().join(" ")).toBe("connect failed for [redacted]");
    expect(error.mock.calls.flat().join(" ")).not.toContain(TICKET);
  });
});
