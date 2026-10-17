import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

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

  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  // Serverless: keep a small multi-slot pool so a worker tick and dashboard
  // reads can share the transaction pooler (connection_limit=1 starved UI).
  const defaultLimit = serverless ? "3" : "20";

  if (!/connection_limit=/i.test(url)) {
    url += url.includes("?") ? "&" : "?";
    url += `connection_limit=${defaultLimit}&pool_timeout=30`;
  } else if (serverless && /([?&])connection_limit=1(?=&|$)/i.test(url)) {
    url = url.replace(/([?&])connection_limit=1(?=&|$)/i, `$1connection_limit=${defaultLimit}`);
  }

  if (!/pool_timeout=/i.test(url)) {
    url += url.includes("?") ? "&" : "?";
    url += "pool_timeout=30";
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
