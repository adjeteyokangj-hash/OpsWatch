import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildDatabaseUrl() {
  const base = process.env.DATABASE_URL ?? "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=5&pool_timeout=15`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: buildDatabaseUrl() } }
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}