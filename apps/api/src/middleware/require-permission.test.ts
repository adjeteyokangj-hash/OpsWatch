import express from "express";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { requirePermission } from "./require-permission";

const requestAs = async (role: string | undefined) => {
  const app = express();
  app.get(
    "/protected",
    (req: any, _res, next) => {
      req.user = role ? { role, organizationId: "org-1" } : undefined;
      next();
    },
    requirePermission("remediation:auto_heal"),
    (_req, res) => {
      res.status(200).json({ ok: true });
    }
  );

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/protected`);
  } finally {
    server.close();
  }
};

describe("requirePermission", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await requestAs(undefined);
    expect(response.status).toBe(401);
  }, 10000);

  it("rejects viewers from auto-heal", async () => {
    const response = await requestAs("VIEWER");
    expect(response.status).toBe(403);
  });

  it("allows automation operators to trigger auto-heal", async () => {
    const response = await requestAs("AUTOMATION_OPERATOR");
    expect(response.status).toBe(200);
  });
});
