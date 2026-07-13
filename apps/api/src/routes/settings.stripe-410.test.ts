import { afterEach, describe, expect, it, vi } from "vitest";

const projectId = "11111111-1111-4111-8111-111111111111";

const { mockProjectFindFirst, mockUpsert } = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockUpsert: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    projectIntegration: {
      upsert: mockUpsert,
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../services/integration-validation.service", () => ({
  buildSavedIntegrationDetails: vi.fn(),
  validateIntegrationConnectivity: vi.fn()
}));

import express from "express";
import { AddressInfo } from "node:net";
import { settingsRouter } from "./settings.routes";

const requestSettings = async (method: string, path: string, body?: unknown) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { user?: { sub: string; organizationId: string; role: string } }).user = {
      sub: "user-1",
      organizationId: "org-1",
      role: "ADMIN"
    };
    next();
  });
  app.use(settingsRouter);

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
  } finally {
    server.close();
  }
};

describe("settings.routes Stripe compatibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 410 for project Stripe upsert with admin redirect", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: projectId });
    const response = await requestSettings("PUT", `/settings/integrations/${projectId}/STRIPE`, {
      enabled: true,
      configJson: { STRIPE_API_KEY: "sk_test_123" }
    });
    const payload = (await response.json()) as { redirectTo?: string; error?: string };
    expect(response.status).toBe(410);
    expect(payload.redirectTo).toBe("/admin/billing/stripe");
    expect(payload.error).toMatch(/Stripe/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 410 for project Stripe validate with admin redirect", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: projectId });
    const response = await requestSettings("POST", `/settings/integrations/${projectId}/STRIPE/validate`);
    const payload = (await response.json()) as { redirectTo?: string };
    expect(response.status).toBe(410);
    expect(payload.redirectTo).toBe("/admin/billing/stripe");
  });
});
