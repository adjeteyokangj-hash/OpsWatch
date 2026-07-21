import { describe, expect, it } from "vitest";
import { TICK_LOCK_KEY, acquireTickLock, type TickLockPrisma } from "./serverless-tick-lock";

type LockRow = {
  key: string;
  holder: string | null;
  lockedAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
};

/**
 * In-memory stand-in for the WorkerTickLock table that reproduces the
 * conditional-UPDATE semantics the lease relies on (atomic claim / release).
 */
const makeLockPrisma = (): TickLockPrisma & { _row: () => LockRow | null } => {
  let row: LockRow | null = null;

  const matchesClaim = (now: Date): boolean =>
    !!row && (row.holder === null || row.expiresAt === null || row.expiresAt.getTime() < now.getTime());

  return {
    _row: () => row,
    workerTickLock: {
      upsert: async ({ create }) => {
        if (!row) {
          row = { key: create.key, holder: null, lockedAt: null, expiresAt: null, updatedAt: create.updatedAt };
        }
      },
      updateMany: async ({ where, data }: any) => {
        if (!row || where.key !== row.key) {
          return { count: 0 };
        }
        // Release path: matches on an explicit holder.
        if (typeof where.holder === "string") {
          if (row.holder !== where.holder) {
            return { count: 0 };
          }
          row = { ...row, ...data };
          return { count: 1 };
        }
        // Claim path: OR over holder null / expiresAt null / expiresAt < now.
        const now = data.lockedAt as Date;
        if (!matchesClaim(now)) {
          return { count: 0 };
        }
        row = { ...row, ...data };
        return { count: 1 };
      }
    }
  };
};

const now = new Date("2026-07-21T07:00:00.000Z");

describe("acquireTickLock", () => {
  it("grants the lease to the first caller", async () => {
    const prisma = makeLockPrisma();
    const lock = await acquireTickLock(prisma, "holder-1", 60_000, now);
    expect(lock.acquired).toBe(true);
    expect(prisma._row()?.holder).toBe("holder-1");
  });

  it("denies a second concurrent caller while the lease is held (overlap protection)", async () => {
    const prisma = makeLockPrisma();
    const first = await acquireTickLock(prisma, "holder-1", 60_000, now);
    const second = await acquireTickLock(prisma, "holder-2", 60_000, now);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(prisma._row()?.holder).toBe("holder-1");
  });

  it("allows a new caller after the holder releases", async () => {
    const prisma = makeLockPrisma();
    const first = await acquireTickLock(prisma, "holder-1", 60_000, now);
    await first.release();
    expect(prisma._row()?.holder).toBeNull();

    const later = new Date(now.getTime() + 1_000);
    const second = await acquireTickLock(prisma, "holder-2", 60_000, later);
    expect(second.acquired).toBe(true);
    expect(prisma._row()?.holder).toBe("holder-2");
  });

  it("lets a new caller take over an expired lease (crash recovery via TTL)", async () => {
    const prisma = makeLockPrisma();
    const first = await acquireTickLock(prisma, "holder-1", 10_000, now);
    expect(first.acquired).toBe(true);

    // Simulate the holder crashing without releasing; time advances past TTL.
    const afterExpiry = new Date(now.getTime() + 11_000);
    const second = await acquireTickLock(prisma, "holder-2", 10_000, afterExpiry);
    expect(second.acquired).toBe(true);
    expect(prisma._row()?.holder).toBe("holder-2");
  });

  it("release only clears the lease when the caller still owns it", async () => {
    const prisma = makeLockPrisma();
    const first = await acquireTickLock(prisma, "holder-1", 10_000, now);

    // A stale holder that lost the lease should not clear the current holder's lease.
    const afterExpiry = new Date(now.getTime() + 11_000);
    const second = await acquireTickLock(prisma, "holder-2", 10_000, afterExpiry);
    expect(second.acquired).toBe(true);

    await first.release();
    // holder-2 still owns it because holder-1's release matched no row.
    expect(prisma._row()?.holder).toBe("holder-2");
  });

  it("uses the shared lock key", () => {
    expect(TICK_LOCK_KEY).toBe("serverless-worker-tick");
  });
});
