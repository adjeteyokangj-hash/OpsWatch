import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type BatchedCheckResultRow = {
  checkId: string;
  status: string;
  checkedAt: Date;
  responseTimeMs: number | null;
  responseCode?: number | null;
  message?: string | null;
};

/**
 * Top-N CheckResult rows per check in one SQL round-trip.
 * Avoids Prisma nested `take` which issues one query per parent — disastrous with
 * Vercel Prisma `connection_limit=1`.
 */
export const loadRecentCheckResultsByCheckIds = async (
  checkIds: string[],
  perCheck = 12
): Promise<Map<string, BatchedCheckResultRow[]>> => {
  const grouped = new Map<string, BatchedCheckResultRow[]>();
  if (checkIds.length === 0 || perCheck <= 0) return grouped;

  const rows = await prisma.$queryRaw<BatchedCheckResultRow[]>`
    SELECT "checkId", status, "checkedAt", "responseTimeMs", "responseCode", message
    FROM (
      SELECT
        "checkId",
        status,
        "checkedAt",
        "responseTimeMs",
        "responseCode",
        message,
        ROW_NUMBER() OVER (PARTITION BY "checkId" ORDER BY "checkedAt" DESC) AS rn
      FROM "CheckResult"
      WHERE "checkId" IN (${Prisma.join(checkIds)})
    ) ranked
    WHERE rn <= ${perCheck}
    ORDER BY "checkId", "checkedAt" DESC
  `;

  for (const row of rows) {
    const list = grouped.get(row.checkId) ?? [];
    list.push({
      checkId: row.checkId,
      status: row.status,
      checkedAt: row.checkedAt instanceof Date ? row.checkedAt : new Date(row.checkedAt),
      responseTimeMs: row.responseTimeMs,
      responseCode: row.responseCode ?? null,
      message: row.message ?? null
    });
    grouped.set(row.checkId, list);
  }
  return grouped;
};

/** Latest CheckResult per check (one SQL round-trip). */
export const loadLatestCheckResultsByCheckIds = async (
  checkIds: string[]
): Promise<Map<string, BatchedCheckResultRow>> => {
  const latest = new Map<string, BatchedCheckResultRow>();
  if (checkIds.length === 0) return latest;

  const rows = await prisma.$queryRaw<BatchedCheckResultRow[]>`
    SELECT DISTINCT ON ("checkId")
      "checkId", status, "checkedAt", "responseTimeMs", "responseCode", message
    FROM "CheckResult"
    WHERE "checkId" IN (${Prisma.join(checkIds)})
    ORDER BY "checkId", "checkedAt" DESC
  `;

  for (const row of rows) {
    latest.set(row.checkId, {
      checkId: row.checkId,
      status: row.status,
      checkedAt: row.checkedAt instanceof Date ? row.checkedAt : new Date(row.checkedAt),
      responseTimeMs: row.responseTimeMs,
      responseCode: row.responseCode ?? null,
      message: row.message ?? null
    });
  }
  return latest;
};
