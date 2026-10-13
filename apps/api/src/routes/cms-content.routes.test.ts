import express from "express";
import http from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/cms-content/cms-content.service", () => ({
  verifyCmsApiKey: vi.fn(async (key: string | null | undefined) => key === "good-key"),
  listCmsCapabilities: () => ({
    ok: true,
    adapter: "opswatch_marketing",
    capabilities: { customer_data: false, billing_records: false },
    modules: [{ code: "opswatch.page.home", label: "Homepage", kind: "page" }]
  }),
  getModuleContent: vi.fn(async (code: string) =>
    code === "opswatch.page.home"
      ? {
          code,
          draft: { cmsKey: code },
          published: null,
          draft_revision: 1,
          published_revision: 0,
          updated_at: null,
          published_at: null
        }
      : null
  ),
  putModuleContent: vi.fn(async () => ({
    ok: true,
    state: {
      code: "opswatch.page.home",
      draft: { cmsKey: "opswatch.page.home" },
      published: null,
      draft_revision: 1,
      published_revision: 0,
      updated_at: null,
      published_at: null
    }
  })),
  publishModuleContent: vi.fn(async () => ({
    ok: true,
    state: {
      code: "opswatch.page.home",
      draft: { cmsKey: "opswatch.page.home" },
      published: { cmsKey: "opswatch.page.home" },
      draft_revision: 1,
      published_revision: 1,
      updated_at: null,
      published_at: null
    }
  })),
  rollbackModuleContent: vi.fn(async () => ({
    ok: true,
    state: {
      code: "opswatch.page.home",
      draft: { cmsKey: "opswatch.page.home" },
      published: { cmsKey: "opswatch.page.home" },
      draft_revision: 2,
      published_revision: 2,
      updated_at: null,
      published_at: null
    }
  })),
  listPublishedModules: vi.fn(async () => ({})),
  listDraftModules: vi.fn(async () => ({}))
}));

import { cmsContentRouter } from "./cms-content.routes";

const app = express();
app.use(express.json());
app.use("/api/cms", cmsContentRouter);

const withServer = async (
  run: (baseUrl: string) => Promise<void>
): Promise<void> => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
};

describe("cms-content.routes", () => {
  beforeEach(() => {
    process.env.OPSWATCH_CMS_PREVIEW_SECRET = "preview-secret";
  });

  it("serves health without API key", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/cms/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { adapter?: string };
      expect(body.adapter).toBe("opswatch_marketing");
    });
  });

  it("rejects capabilities without API key", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/cms/v1/capabilities`);
      expect(res.status).toBe(401);
    });
  });

  it("allows capabilities with API key", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/cms/v1/capabilities`, {
        headers: { "X-Api-Key": "good-key" }
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { capabilities?: { customer_data?: boolean } };
      expect(body.capabilities?.customer_data).toBe(false);
    });
  });

  it("supports put and publish with API key", async () => {
    await withServer(async (baseUrl) => {
      const put = await fetch(`${baseUrl}/api/cms/v1/modules/opswatch.page.home/content`, {
        method: "PUT",
        headers: { "X-Api-Key": "good-key", "Content-Type": "application/json" },
        body: JSON.stringify({ cmsKey: "opswatch.page.home" })
      });
      expect(put.status).toBe(200);

      const publish = await fetch(`${baseUrl}/api/cms/v1/modules/opswatch.page.home/publish`, {
        method: "POST",
        headers: { "X-Api-Key": "good-key", "Content-Type": "application/json" },
        body: "{}"
      });
      expect(publish.status).toBe(200);
      const body = (await publish.json()) as { published_revision?: number };
      expect(body.published_revision).toBe(1);
    });
  });
});
