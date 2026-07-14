import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** True when the DB has User.isPlatformSuperAdmin (after migrate). Cached per isolate. */
let columnAvailable: boolean | null = null;

export const resetPlatformSuperAdminColumnCache = (): void => {
  columnAvailable = null;
};

export const hasPlatformSuperAdminColumn = async (): Promise<boolean> => {
  if (columnAvailable !== null) {
    return columnAvailable;
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
    columnAvailable = Boolean(rows[0]?.exists);
  } catch {
    columnAvailable = false;
  }
  return columnAvailable;
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
    columnAvailable = false;
    return new Map();
  }
};

export const setPlatformSuperAdminFlag = async (userId: string, enabled: boolean): Promise<void> => {
  if (!(await hasPlatformSuperAdminColumn())) {
    throw new Error(
      "Database migrations are incomplete. Run prisma migrate deploy with Supabase session pooler DIRECT_URL, then retry."
    );
  }
  try {
    await prisma.$executeRaw`
      UPDATE "User"
      SET "isPlatformSuperAdmin" = ${enabled}, "updatedAt" = NOW()
      WHERE id = ${userId}
    `;
  } catch (error) {
    columnAvailable = false;
    throw error;
  }
};
