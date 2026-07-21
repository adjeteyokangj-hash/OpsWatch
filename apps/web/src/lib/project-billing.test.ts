import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeInvoices,
  formatInterval,
  formatPaymentMethod,
  intervalPrice,
  intervalSuffix
} from "./project-billing";

describe("billing interval helpers", () => {
  it("computes interval price and suffix", () => {
    expect(intervalPrice(29, "MONTHLY")).toBe(29);
    expect(intervalPrice(29, "ANNUAL")).toBe(29 * 12);
    expect(intervalSuffix("MONTHLY")).toBe("/ month");
    expect(intervalSuffix("ANNUAL")).toBe("/ year");
    expect(formatInterval("ANNUAL")).toBe("Annual");
    expect(formatInterval("MONTHLY")).toBe("Monthly");
  });
});

describe("formatPaymentMethod", () => {
  it("returns a friendly label with brand, last4, and expiry", () => {
    expect(
      formatPaymentMethod({ brand: "Visa", last4: "4242", expMonth: 4, expYear: 2027 })
    ).toBe("Visa •••• 4242 · expires 04/2027");
  });

  it("falls back when no method is on file", () => {
    expect(formatPaymentMethod(null)).toBe("No payment method on file");
    expect(formatPaymentMethod({ brand: null, last4: null, expMonth: null, expYear: null })).toBe(
      "No payment method on file"
    );
  });
});

describe("computeInvoices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no invoices for a free (zero-price) plan", () => {
    expect(
      computeInvoices({
        monthlyPrice: 0,
        currency: "GBP",
        interval: "MONTHLY",
        billingStartDate: "2026-01-01T00:00:00Z"
      })
    ).toEqual([]);
  });

  it("issues a paid invoice per elapsed monthly period plus one upcoming invoice", () => {
    const invoices = computeInvoices({
      monthlyPrice: 29,
      currency: "GBP",
      interval: "MONTHLY",
      billingStartDate: "2026-05-01T00:00:00Z",
      billingStatus: "ACTIVE"
    });

    const upcoming = invoices.filter((invoice) => invoice.status === "UPCOMING");
    const paid = invoices.filter((invoice) => invoice.status === "PAID");
    expect(upcoming).toHaveLength(1);
    // May, June, July billed since the May 1 start (as of 21 Jul 2026).
    expect(paid).toHaveLength(3);
    expect(paid.every((invoice) => invoice.amount === 29)).toBe(true);
  });

  it("scales annual invoices to twelve months and marks past-due", () => {
    const invoices = computeInvoices({
      monthlyPrice: 99,
      currency: "GBP",
      interval: "ANNUAL",
      billingStartDate: "2026-01-01T00:00:00Z",
      billingStatus: "PAST_DUE"
    });

    const billed = invoices.filter((invoice) => invoice.status !== "UPCOMING");
    expect(billed[0]?.amount).toBe(99 * 12);
    // Past-due plans surface the latest billed invoice as DUE and no upcoming invoice.
    expect(invoices.some((invoice) => invoice.status === "DUE")).toBe(true);
    expect(invoices.some((invoice) => invoice.status === "UPCOMING")).toBe(false);
  });
});
