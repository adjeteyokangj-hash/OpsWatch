/**
 * Cross-process single-run guarantee for the serverless worker tick.
 *
 * Two concurrent Supabase Cron invocations (or an overlapping manual call) must
 * never run the job batch at the same time. We use a database lease row rather
 * than a session-scoped `pg_try_advisory_lock`, because the production API runs
 * behind Supabase's PgBouncer transaction pooler where session-level advisory
 * locks are not preserved across queries. The lease is acquired with a single
 * atomic conditional `UPDATE` (row-locked by Postgres) and always released in a
 * `finally` block; a TTL guards against a crashed invocation holding it forever.
 */

export const TICK_LOCK_KEY = "serverless-worker-tick";

/** Minimal Prisma surface required by the lease lock (satisfied by PrismaClient). */
export interface TickLockPrisma {
  workerTickLock: {
    upsert(args: {
      where: { key: string };
      create: { key: string; updatedAt: Date };
      update: Record<string, never>;
    }): Promise<unknown>;
    updateMany(args: {
      where: unknown;
      data: {
        holder?: string | null;
        lockedAt?: Date | null;
        expiresAt?: Date | null;
        updatedAt: Date;
      };
    }): Promise<{ count: number }>;
  };
}

export type TickLock = {
  acquired: boolean;
  holder: string;
  release: () => Promise<void>;
};

const NOOP_RELEASE = async (): Promise<void> => {};

/**
 * Attempt to acquire the tick lease.
 *
 * @returns `acquired: true` with a `release()` that clears the lease iff this
 * holder still owns it, or `acquired: false` when another tick holds an
 * unexpired lease (caller should skip quickly).
 */
export const acquireTickLock = async (
  prisma: TickLockPrisma,
  holder: string,
  ttlMs: number,
  now: Date = new Date()
): Promise<TickLock> => {
  // Ensure the single lease row exists. Concurrent creates can race; a unique
  // violation just means another invocation created it first, which is fine.
  try {
    await prisma.workerTickLock.upsert({
      where: { key: TICK_LOCK_KEY },
      create: { key: TICK_LOCK_KEY, updatedAt: now },
      update: {}
    });
  } catch {
    // Row already exists (or lost a create race) — proceed to the atomic claim.
  }

  const expiresAt = new Date(now.getTime() + ttlMs);
  const claim = await prisma.workerTickLock.updateMany({
    where: {
      key: TICK_LOCK_KEY,
      OR: [{ holder: null }, { expiresAt: null }, { expiresAt: { lt: now } }]
    },
    data: { holder, lockedAt: now, expiresAt, updatedAt: now }
  });

  if (claim.count === 0) {
    return { acquired: false, holder, release: NOOP_RELEASE };
  }

  return {
    acquired: true,
    holder,
    release: async () => {
      const releasedAt = new Date();
      await prisma.workerTickLock.updateMany({
        where: { key: TICK_LOCK_KEY, holder },
        data: { holder: null, lockedAt: null, expiresAt: releasedAt, updatedAt: releasedAt }
      });
    }
  };
};
