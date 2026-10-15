import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "../../lib/prisma";
import {
  assertNoBillingFields,
  CMS_MODULE_CATALOGUE,
  CMS_MODULE_CODES,
  isCmsModuleCode,
  validateCmsModulePayload,
  type CmsModuleCode
} from "./cms-content-contract";

export type CmsModuleState = {
  code: CmsModuleCode;
  draft: unknown | null;
  published: unknown | null;
  draft_revision: number;
  published_revision: number;
  updated_at: string | null;
  published_at: string | null;
};

/** Known local fallback. Never accepted when NODE_ENV is production. */
export const CMS_DEV_API_KEY = "opswatch-cms-dev-key-not-for-production";

const hashKey = (raw: string): string => createHash("sha256").update(raw).digest("hex");

const safeEqualHex = (a: string, b: string): boolean => {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
};

/**
 * Env key, or the local fallback outside production.
 * Production ignores a missing key and the known development literal.
 */
export const resolveDevCmsApiKey = (): string | null => {
  const fromEnv = process.env.OPSWATCH_CMS_API_KEY?.trim() || "";
  if (process.env.NODE_ENV === "production") {
    if (!fromEnv || fromEnv === CMS_DEV_API_KEY) return null;
    return fromEnv;
  }
  return fromEnv || CMS_DEV_API_KEY;
};

export const verifyCmsApiKey = async (rawKey: string | undefined | null): Promise<boolean> => {
  if (!rawKey?.trim()) return false;
  const provided = rawKey.trim();
  const envKey = resolveDevCmsApiKey();
  if (envKey && provided === envKey) return true;

  const hash = hashKey(provided);
  const rows = await prisma.marketingCmsApiKey.findMany({
    where: { isActive: true, revokedAt: null },
    select: { id: true, keyHash: true }
  });
  for (const row of rows) {
    if (safeEqualHex(row.keyHash, hash)) {
      await prisma.marketingCmsApiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() }
      });
      return true;
    }
  }
  return false;
};

export const createCmsApiKey = async (name: string): Promise<{ id: string; apiKey: string; prefix: string }> => {
  const apiKey = `owcms_${randomBytes(24).toString("hex")}`;
  const id = crypto.randomUUID();
  const prefix = apiKey.slice(0, 12);
  await prisma.marketingCmsApiKey.create({
    data: {
      id,
      name,
      keyHash: hashKey(apiKey),
      keyPrefix: prefix,
      isActive: true
    }
  });
  return { id, apiKey, prefix };
};

const getOrCreateDocument = async (cmsKey: CmsModuleCode) => {
  const existing = await prisma.marketingContentDocument.findUnique({ where: { cmsKey } });
  if (existing) return existing;
  return prisma.marketingContentDocument.create({
    data: {
      id: crypto.randomUUID(),
      cmsKey,
      draftRevision: 0,
      publishedRevision: 0,
      updatedAt: new Date()
    }
  });
};

export const listCmsCapabilities = () => ({
  ok: true,
  adapter: "opswatch_marketing",
  product: "OpsWatch",
  live_client: false,
  capabilities: {
    edit: true,
    preview: true,
    draft: true,
    submit: true,
    publish: true,
    rollback: true,
    media: false,
    modules: true,
    pricing_amounts: false,
    customer_data: false,
    billing_records: false,
    monitoring_operations: false
  },
  modules: CMS_MODULE_CATALOGUE.map((module) => ({
    code: module.code,
    label: module.label,
    kind: module.kind
  })),
  forbidden: {
    note: "This API only accepts public marketing website content modules.",
    billing_fields: ["monthlyPrice", "annualPrice", "stripePriceId", "entitlements", "planCode"]
  }
});

export const getModuleContent = async (code: string): Promise<CmsModuleState | null> => {
  if (!isCmsModuleCode(code)) return null;
  const doc = await prisma.marketingContentDocument.findUnique({ where: { cmsKey: code } });
  return {
    code,
    draft: doc?.draftJson ?? null,
    published: doc?.publishedJson ?? null,
    draft_revision: doc?.draftRevision ?? 0,
    published_revision: doc?.publishedRevision ?? 0,
    updated_at: doc?.updatedAt?.toISOString() ?? null,
    published_at: doc?.publishedAt?.toISOString() ?? null
  };
};

export const putModuleContent = async (
  code: string,
  content: unknown,
  actorLabel?: string
): Promise<{ ok: true; state: CmsModuleState } | { ok: false; error: string; status: number }> => {
  if (!isCmsModuleCode(code)) {
    return { ok: false, error: "Unknown module_code", status: 404 };
  }
  const validated = validateCmsModulePayload(code, content);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  const doc = await getOrCreateDocument(code);
  const nextRevision = doc.draftRevision + 1;
  const updated = await prisma.marketingContentDocument.update({
    where: { id: doc.id },
    data: {
      draftJson: content as object,
      draftRevision: nextRevision,
      updatedAt: new Date()
    }
  });
  await prisma.marketingContentRevision.create({
    data: {
      id: crypto.randomUUID(),
      documentId: doc.id,
      revisionNo: nextRevision,
      kind: "draft",
      contentJson: content as object,
      actorLabel: actorLabel ?? "okanggroup-cms"
    }
  });
  return {
    ok: true,
    state: {
      code,
      draft: updated.draftJson,
      published: updated.publishedJson,
      draft_revision: updated.draftRevision,
      published_revision: updated.publishedRevision,
      updated_at: updated.updatedAt.toISOString(),
      published_at: updated.publishedAt?.toISOString() ?? null
    }
  };
};

export const publishModuleContent = async (
  code: string,
  actorLabel?: string
): Promise<{ ok: true; state: CmsModuleState } | { ok: false; error: string; status: number }> => {
  if (!isCmsModuleCode(code)) {
    return { ok: false, error: "Unknown module_code", status: 404 };
  }
  const doc = await getOrCreateDocument(code);
  if (doc.draftJson == null) {
    return { ok: false, error: "No draft content to publish", status: 400 };
  }
  const billing = assertNoBillingFields(doc.draftJson);
  if (!billing.ok) return { ok: false, error: billing.error, status: 400 };

  const nextPublished = doc.publishedRevision + 1;
  const updated = await prisma.marketingContentDocument.update({
    where: { id: doc.id },
    data: {
      publishedJson: doc.draftJson as object,
      publishedRevision: nextPublished,
      publishedAt: new Date(),
      updatedAt: new Date()
    }
  });
  await prisma.marketingContentRevision.create({
    data: {
      id: crypto.randomUUID(),
      documentId: doc.id,
      revisionNo: nextPublished,
      kind: "published",
      contentJson: doc.draftJson as object,
      actorLabel: actorLabel ?? "okanggroup-cms"
    }
  });
  return {
    ok: true,
    state: {
      code,
      draft: updated.draftJson,
      published: updated.publishedJson,
      draft_revision: updated.draftRevision,
      published_revision: updated.publishedRevision,
      updated_at: updated.updatedAt.toISOString(),
      published_at: updated.publishedAt?.toISOString() ?? null
    }
  };
};

export const rollbackModuleContent = async (
  code: string,
  revisionNo?: number,
  actorLabel?: string
): Promise<{ ok: true; state: CmsModuleState } | { ok: false; error: string; status: number }> => {
  if (!isCmsModuleCode(code)) {
    return { ok: false, error: "Unknown module_code", status: 404 };
  }
  const doc = await getOrCreateDocument(code);
  const target =
    revisionNo != null
      ? await prisma.marketingContentRevision.findFirst({
          where: { documentId: doc.id, kind: "published", revisionNo },
          orderBy: { createdAt: "desc" }
        })
      : await prisma.marketingContentRevision.findFirst({
          where: {
            documentId: doc.id,
            kind: "published",
            revisionNo: { lt: doc.publishedRevision }
          },
          orderBy: { revisionNo: "desc" }
        });

  if (!target) {
    return { ok: false, error: "No published revision available to restore", status: 404 };
  }

  const nextPublished = doc.publishedRevision + 1;
  const updated = await prisma.marketingContentDocument.update({
    where: { id: doc.id },
    data: {
      publishedJson: target.contentJson as object,
      draftJson: target.contentJson as object,
      publishedRevision: nextPublished,
      draftRevision: doc.draftRevision + 1,
      publishedAt: new Date(),
      updatedAt: new Date()
    }
  });
  await prisma.marketingContentRevision.create({
    data: {
      id: crypto.randomUUID(),
      documentId: doc.id,
      revisionNo: nextPublished,
      kind: "published",
      contentJson: target.contentJson as object,
      actorLabel: actorLabel ?? `rollback:${target.revisionNo}`
    }
  });
  return {
    ok: true,
    state: {
      code,
      draft: updated.draftJson,
      published: updated.publishedJson,
      draft_revision: updated.draftRevision,
      published_revision: updated.publishedRevision,
      updated_at: updated.updatedAt.toISOString(),
      published_at: updated.publishedAt?.toISOString() ?? null
    }
  };
};

export const listPublishedModules = async (): Promise<Record<string, unknown>> => {
  const docs = await prisma.marketingContentDocument.findMany();
  const out: Record<string, unknown> = {};
  for (const doc of docs) {
    if (doc.publishedJson != null) out[doc.cmsKey] = doc.publishedJson;
  }
  return out;
};

export const listDraftModules = async (): Promise<Record<string, unknown>> => {
  const docs = await prisma.marketingContentDocument.findMany();
  const out: Record<string, unknown> = {};
  for (const doc of docs) {
    if (doc.draftJson != null) out[doc.cmsKey] = doc.draftJson;
  }
  return out;
};

export const knownModuleCodes = (): readonly string[] => CMS_MODULE_CODES;
