import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * True when the database has User.isPlatformSuperAdmin.
 * Only cache positives so a previously missing column is re-probed after an
 * explicitly approved, separately executed database change.
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

/**
 * Read-only schema readiness guard.
 *
 * OpsWatch Rule 6 prohibits application runtime from repairing or migrating the
 * database. Missing schema must be reported and handled through a separately
 * approved migration command; this function deliberately performs no ALTER.
 */
export const ensurePlatformSuperAdminColumn = async (): Promise<void> => {
  if (await hasPlatformSuperAdminColumn()) {
    return;
  }

  throw new Error(
    "Database schema is missing User.isPlatformSuperAdmin. OpsWatch Rule 6 blocks runtime schema changes; obtain EDD's explicit migration approval before changing the database."
  );
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
