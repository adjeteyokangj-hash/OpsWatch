import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * True when the DB has User.isPlatformSuperAdmin (after migrate or ensure).
 * Only cache positives — a prior false must be re-probed so grants recover after
 * migrate deploy without waiting for a cold start.
 */
let columnAvailable: boolean | null = null;

export const resetPlatformSuperAdminColumnCache = (): void => {
  columnAvailable = null;
};

export const hasPlatformSuperAdminColumn = async (): Promise<boolean> => {
  if (columnAvailable === true) {
    return true;
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'isPlatformSuperAdmin'
      ) AS "exists"
    `;
    if (Boolean(rows[0]?.exists)) {
      columnAvailable = true;
      return true;
    }
    columnAvailable = null;
    return false;
  } catch {
    columnAvailable = null;
    return false;
  }
};

/** Idempotent: ADD COLUMN IF NOT EXISTS so grant works without waiting on migrate. */
export const ensurePlatformSuperAdminColumn = async (): Promise<void> => {
  if (await hasPlatformSuperAdminColumn()) {
    return;
  }
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPlatformSuperAdmin" BOOLEAN NOT NULL DEFAULT false
    `);
  } catch (error) {
    resetPlatformSuperAdminColumnCache();
    throw new Error(
      "Database migrations are incomplete. Run prisma migrate deploy with Supabase session pooler DIRECT_URL, then retry."
    );
  }
  resetPlatformSuperAdminColumnCache();
  if (!(await hasPlatformSuperAdminColumn())) {
    throw new Error(
      "Database migrations are incomplete. Run prisma migrate deploy with Supabase session pooler DIRECT_URL, then retry."
    );
  }
};

export const loadPlatformSuperAdminFlags = async (
  userIds: string[]
): Promise<Map<string, boolean>> => {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) {
    return new Map();
  }
  if (!(await hasPlatformSuperAdminColumn())) {
    return new Map();
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; isPlatformSuperAdmin: boolean }>>`
      SELECT id, "isPlatformSuperAdmin"
      FROM "User"
      WHERE id IN (${Prisma.join(unique)})
    `;
    return new Map(rows.map((row) => [row.id, Boolean(row.isPlatformSuperAdmin)]));
  } catch {
    resetPlatformSuperAdminColumnCache();
    return new Map();
  }
};

export const setPlatformSuperAdminFlag = async (userId: string, enabled: boolean): Promise<void> => {
  await ensurePlatformSuperAdminColumn();
  try {
    await prisma.$executeRaw`
      UPDATE "User"
      SET "isPlatformSuperAdmin" = ${enabled}, "updatedAt" = NOW()
      WHERE id = ${userId}
    `;
  } catch (error) {
    resetPlatformSuperAdminColumnCache();
    throw error;
  }
};
