import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const documentStore = new Map<string, any>();
const revisionStore: any[] = [];
const keyStore: any[] = [];

vi.mock("../../lib/prisma", () => ({
  prisma: {
    marketingContentDocument: {
      findUnique: vi.fn(async ({ where }: any) => documentStore.get(where.cmsKey) ?? null),
      findMany: vi.fn(async () => Array.from(documentStore.values())),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, publishedAt: data.publishedAt ?? null };
        documentStore.set(data.cmsKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const current = Array.from(documentStore.values()).find((row) => row.id === where.id);
        const next = { ...current, ...data };
        documentStore.set(next.cmsKey, next);
        return next;
      })
    },
    marketingContentRevision: {
      create: vi.fn(async ({ data }: any) => {
        revisionStore.push(data);
        return data;
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = revisionStore.filter((row) => row.documentId === where.documentId && row.kind === where.kind);
        if (where.revisionNo?.lt != null) {
          rows = rows.filter((row) => row.revisionNo < where.revisionNo.lt);
        } else if (typeof where.revisionNo === "number") {
          rows = rows.filter((row) => row.revisionNo === where.revisionNo);
        }
        rows.sort((a, b) =>
          orderBy?.revisionNo === "desc" || orderBy?.createdAt === "desc"
            ? b.revisionNo - a.revisionNo
            : a.revisionNo - b.revisionNo
        );
        return rows[0] ?? null;
      })
    },
    marketingCmsApiKey: {
      findMany: vi.fn(async () => keyStore.filter((row) => row.isActive && !row.revokedAt)),
      create: vi.fn(async ({ data }: any) => {
        keyStore.push(data);
        return data;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = keyStore.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return row;
      })
    }
  }
}));

import {
  CMS_DEV_API_KEY,
  createCmsApiKey,
  getModuleContent,
  listCmsCapabilities,
  publishModuleContent,
  putModuleContent,
  rollbackModuleContent,
  verifyCmsApiKey
} from "./cms-content.service";

const sampleHome = {
  slug: "home",
  cmsKey: "opswatch.page.home",
  metaTitle: "Home",
  metaDescription: "Home desc",
  hero: { eyebrow: "E", title: "T", subtitle: "S" },
  sections: [{ id: "capabilities", cmsKey: "opswatch.page.home.capabilities", title: "Caps" }]
};

describe("cms-content.service", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousApiKey = process.env.OPSWATCH_CMS_API_KEY;

  beforeEach(() => {
    documentStore.clear();
    revisionStore.length = 0;
    keyStore.length = 0;
    process.env.OPSWATCH_CMS_API_KEY = "test-cms-key";
  });

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousApiKey === undefined) delete process.env.OPSWATCH_CMS_API_KEY;
    else process.env.OPSWATCH_CMS_API_KEY = previousApiKey;
  });

  it("exposes marketing-only capabilities", () => {
    const caps = listCmsCapabilities();
    expect(caps.capabilities.customer_data).toBe(false);
    expect(caps.capabilities.billing_records).toBe(false);
    expect(caps.capabilities.monitoring_operations).toBe(false);
    expect(caps.capabilities.pricing_amounts).toBe(false);
    expect(caps.modules.some((module) => module.code === "opswatch.page.home")).toBe(true);
  });

  it("rejects billing fields in put payloads", async () => {
    const result = await putModuleContent("opswatch.page.pricing", {
      ...sampleHome,
      slug: "pricing",
      cmsKey: "opswatch.page.pricing",
      monthlyPrice: 99
    });
    expect(result.ok).toBe(false);
  });

  it("supports put, publish and rollback", async () => {
    const put = await putModuleContent("opswatch.page.home", sampleHome);
    expect(put.ok).toBe(true);
    if (!put.ok) return;

    const published = await publishModuleContent("opswatch.page.home");
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.state.published_revision).toBe(1);

    const second = {
      ...sampleHome,
      hero: { ...sampleHome.hero, title: "Updated title" }
    };
    await putModuleContent("opswatch.page.home", second);
    await publishModuleContent("opswatch.page.home");

    const rolled = await rollbackModuleContent("opswatch.page.home", 1);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect((rolled.state.published as typeof sampleHome).hero.title).toBe("T");

    const got = await getModuleContent("opswatch.page.home");
    expect(got?.published_revision).toBeGreaterThan(1);
  });

  it("verifies env CMS API key", async () => {
    expect(await verifyCmsApiKey("test-cms-key")).toBe(true);
    expect(await verifyCmsApiKey("wrong")).toBe(false);
    expect(await verifyCmsApiKey(undefined)).toBe(false);
  });

  it("rejects the development key and accepts only a real env key in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.OPSWATCH_CMS_API_KEY;
    expect(await verifyCmsApiKey(CMS_DEV_API_KEY)).toBe(false);

    process.env.OPSWATCH_CMS_API_KEY = CMS_DEV_API_KEY;
    expect(await verifyCmsApiKey(CMS_DEV_API_KEY)).toBe(false);

    process.env.OPSWATCH_CMS_API_KEY = "configured-production-key";
    expect(await verifyCmsApiKey("configured-production-key")).toBe(true);
    expect(await verifyCmsApiKey(CMS_DEV_API_KEY)).toBe(false);
  });

  it("accepts an issued key and rejects it after revocation", async () => {
    const issued = await createCmsApiKey("gateway");
    expect(await verifyCmsApiKey(issued.apiKey)).toBe(true);
    const row = keyStore.find((entry) => entry.id === issued.id);
    row.isActive = false;
    row.revokedAt = new Date();
    expect(await verifyCmsApiKey(issued.apiKey)).toBe(false);
  });
});
