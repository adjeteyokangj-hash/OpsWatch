import { afterEach, describe, expect, it, vi } from "vitest";

/** Duplicate Stripe webhook deliveries are skipped (idempotent). */

const { mockFindUnique, mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    stripeWebhookEvent: { findUnique: mockFindUnique, create: mockCreate, update: mockUpdate }
  }
}));

vi.mock("../entitlements/subscription.service", () => ({ seedPlans: vi.fn() }));

import { handleStripeEvent } from "./stripe.service";

describe("stripe webhook idempotency", () => {
  afterEach(() => vi.clearAllMocks());

  it("skips an already-processed event without reprocessing", async () => {
    mockFindUnique.mockResolvedValue({ id: "rec-1", status: "PROCESSED" });

    await handleStripeEvent({ id: "evt_1", type: "invoice.paid" } as never);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
