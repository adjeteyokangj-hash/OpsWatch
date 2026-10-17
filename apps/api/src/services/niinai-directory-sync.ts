/// <reference path="../types/pg.d.ts" />
import { prisma } from "../lib/prisma";
import { replaceStaffDirectory } from "./user-monitoring-store";
import { sanitizeDirectory, type SanitizedStaff } from "./user-monitoring";

export const NIINAI_DIRECTORY_URL_ENV = "NIINAI_MONITORING_DATABASE_URL";
export const NIINAI_PROJECT_SLUG = "niinai-guest-house";

const DIRECTORY_SQL =
  "select user_id, display_name, role, status, property_access, property_ids from public.monitoring_staff_directory()";

export type DirectorySyncResult =
  | { status: "DISABLED"; reason: string }
  | { status: "SYNCED"; count: number };

type DirectoryClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

export const redactMonitoringSecret = (message: string, secret: string | undefined): string => {
  const trimmed = secret?.trim();
  if (!trimmed) return message;
  return message.split(trimmed).join("[redacted]");
};

const openDirectoryClient = async (connectionString: string): Promise<DirectoryClient> => {
  const { Client } = await import("pg");
  const target = new URL(connectionString);
  const local = target.hostname === "localhost" || target.hostname === "127.0.0.1";
  target.searchParams.delete("sslmode");
  target.searchParams.delete("ssl");
  const client = new Client({
    connectionString: target.toString(),
    ssl: local ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000
  });
  await client.connect();
  return client;
};

/**
 * Pull the restricted NiiNai directory into OpsWatch.
 * An empty or failed read leaves the existing staff rows untouched.
 * This does not verify session tickets and does not read business tables.
 */
export const syncNiinaiStaffDirectory = async (options?: {
  env?: NodeJS.ProcessEnv;
  queryDirectory?: () => Promise<unknown>;
  findProject?: (slug: string) => Promise<{ id: string } | null>;
  replace?: (projectId: string, staff: SanitizedStaff[]) => Promise<number>;
}): Promise<DirectorySyncResult> => {
  const env = options?.env ?? process.env;
  const connectionString = env[NIINAI_DIRECTORY_URL_ENV]?.trim() ?? "";
  if (!connectionString) {
    return { status: "DISABLED", reason: `${NIINAI_DIRECTORY_URL_ENV} is not set` };
  }

  const findProject =
    options?.findProject ??
    ((slug: string) => prisma.project.findUnique({ where: { slug }, select: { id: true } }));
  const project = await findProject(NIINAI_PROJECT_SLUG);
  if (!project) {
    return { status: "DISABLED", reason: "NiiNai Guest House is not registered" };
  }

  let rows: unknown;
  if (options?.queryDirectory) {
    rows = await options.queryDirectory();
  } else {
    const client = await openDirectoryClient(connectionString);
    try {
      const result = await client.query(DIRECTORY_SQL);
      rows = result.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : "NiiNai directory query failed";
      throw new Error(redactMonitoringSecret(message, connectionString));
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const staff = sanitizeDirectory(rows);
  if (staff.length === 0) {
    throw new Error("NiiNai directory returned no staff, so the mirror was left unchanged");
  }

  const replace = options?.replace ?? replaceStaffDirectory;
  const count = await replace(project.id, staff);
  console.log(`NiiNai directory stored ${count} staff`);
  return { status: "SYNCED", count };
};
