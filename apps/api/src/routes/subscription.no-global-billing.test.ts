import { describe, expect, it } from "vitest";
import { rejectGlobalWorkspaceBilling } from "../controllers/global-billing-removed";

/**
 * Confirms the retained /subscription route cannot purchase or manage a global
 * OpsWatch workspace subscription. Checkout and billing-portal initiation are
 * wired to this handler, which returns 410 Gone and points back to per-application
 * billing without touching Stripe.
 */

type FakeRes = {
  statusCode: number;
  body: { error?: string; redirectTo?: string } | undefined;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
};

const makeRes = (): FakeRes => {
  const res = {
    statusCode: 200,
    body: undefined as FakeRes["body"],
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload as FakeRes["body"];
      return res;
    }
  };
  return res;
};

describe("/subscription cannot initiate global workspace billing", () => {
  it("rejects global checkout with 410 and a per-application redirect", () => {
    const res = makeRes();
    rejectGlobalWorkspaceBilling({} as never, res as never);
    expect(res.statusCode).toBe(410);
    expect(res.body?.redirectTo).toBe("/projects");
    expect(res.body?.error).toMatch(/per application/i);
  });

  it("rejects global billing-portal management with 410", () => {
    const res = makeRes();
    rejectGlobalWorkspaceBilling({} as never, res as never);
    expect(res.statusCode).toBe(410);
    expect(res.body?.redirectTo).toBe("/projects");
  });
});
