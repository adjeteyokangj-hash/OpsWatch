import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Build runtime DATABASE_URL with pooler-safe params for Vercel + Supabase. */
export const buildDatabaseUrl = (rawUrl = process.env.DATABASE_URL ?? ""): string => {
  const base = rawUrl.trim();
  if (!base) {
    return base;
  }

  let url = base;
  const usesTransactionPooler = /:6543(\/|$|\?)/.test(url);

  if (usesTransactionPooler && !/pgbouncer=true/i.test(url)) {
    url += url.includes("?") ? "&" : "?";
    url += "pgbouncer=true";
  }

  if (!/connection_limit=/i.test(url)) {
    // Local/dev needs more than serverless (5 was too low for next start + browser smoke storms).
    const limit = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? "1" : "20";
    url += url.includes("?") ? "&" : "?";
    url += `connection_limit=${limit}&pool_timeout=30`;
  }

  return url;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: buildDatabaseUrl() } }
  });

// Reuse one client per serverless isolate (Vercel/Lambda) to avoid duplicate pools.
globalForPrisma.prisma = prisma;
