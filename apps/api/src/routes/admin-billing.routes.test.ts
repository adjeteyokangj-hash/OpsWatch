import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { AuthRequest } from "../middleware/auth";
import { adminBillingRouter } from "./admin-billing.routes";

vi.mock("../controllers/platform-stripe.controller", () => {
  const handler = (_req: unknown, res: express.Response) => res.json({ protectedBilling: true });
  return { disconnectPlatformStripe: handler, getLegacyProjectStripeIntegrations: handler,
    getPlatformStripe: handler, savePlatformStripe: handler, validatePlatformStripe: handler };
});

const appFor = (platformAdmin: boolean) => {
  const app = express();
  app.use((req, _res, next) => {
    (req as AuthRequest).user = { sub: "fixture", id: "fixture", email: "owner@example.test", role: "ADMIN",
      organizationId: "fixture-org", isPlatformSuperAdmin: platformAdmin };
    next();
  });
  app.use("/api", adminBillingRouter);
  app.get("/api/intelligence/operations-status", (_req, res) => res.json({ reachedIntelligence: true }));
  return app;
};

const send = async (platformAdmin: boolean, method: string, path: string) => {
  const server = appFor(platformAdmin).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method });
    return { status: response.status, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
};

describe("platform billing route boundary", () => {
  it("allows ordinary authenticated requests to reach subsequent routers", async () => {
    expect((await send(false, "GET", "/api/intelligence/operations-status")).body).toEqual({ reachedIntelligence: true });
  });
  it("keeps every billing endpoint restricted to platform super admins", async () => {
    for (const suffix of ["", "/validate", "/disconnect", "/legacy-integrations"]) {
      const response = await send(false, suffix === "/validate" || suffix === "/disconnect" ? "POST" : "GET", `/api/admin/billing/stripe${suffix}`);
      expect(response.status).toBe(403);
    }
    expect((await send(false, "PUT", "/api/admin/billing/stripe")).status).toBe(403);
    expect((await send(true, "GET", "/api/admin/billing/stripe")).body).toEqual({ protectedBilling: true });
  });
});
