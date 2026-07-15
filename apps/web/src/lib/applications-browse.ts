/** Helpers for Applications portfolio search, pagination, and test-fixture separation. */

export type ApplicationRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  clientName?: string | null;
  projectOwner?: string | null;
  environment?: string | null;
  healthReason?: string | null;
  status?: string | null;
  Connection?: Array<{ id?: string | null; name?: string | null }>;
  connections?: Array<{ id?: string | null; name?: string | null }>;
  [key: string]: unknown;
};

const TEST_NAME_RE = /\b(smoke|playwright|pw[\s_-]|e2e|isolation|connect.?journey)\b/i;
const TEST_SLUG_RE = /^(pw-|smoke-|e2e-|playwright-|connect-journey)/i;
const TEST_CLIENT_RE = /isolation fixture|smoke fixture|playwright|local connect journey/i;
const TEST_ENVS = new Set(["test", "testing", "e2e", "fixture"]);

export const isTestApplication = (row: ApplicationRow): boolean => {
  const env = String(row.environment || "").trim().toLowerCase();
  if (TEST_ENVS.has(env)) return true;

  const name = String(row.name || "");
  const slug = String(row.slug || "");
  const client = String(row.clientName || "");

  if (TEST_SLUG_RE.test(slug)) return true;
  if (TEST_NAME_RE.test(name) || TEST_NAME_RE.test(slug)) return true;
  if (TEST_CLIENT_RE.test(client)) return true;
  if (/^PW\s+/i.test(name)) return true;
  if (/^connect journey/i.test(name) || /connect journey/i.test(client)) return true;
  return false;
};

export const shortApplicationRef = (row: ApplicationRow): string => {
  const slug = String(row.slug || "").trim();
  if (slug) return slug;
  const id = String(row.id || "");
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
};

const connectionParts = (row: ApplicationRow): string[] => {
  const rows = row.Connection ?? row.connections ?? [];
  return rows.flatMap((connection) =>
    [connection?.id, connection?.name].filter((value): value is string => Boolean(value))
  );
};

export const applicationSearchHaystack = (row: ApplicationRow): string =>
  [
    row.name,
    row.slug,
    row.id,
    row.clientName,
    row.projectOwner,
    row.environment,
    row.healthReason,
    ...connectionParts(row)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const matchesApplicationSearch = (row: ApplicationRow, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return applicationSearchHaystack(row).includes(q);
};

export const CARDS_PAGE_SIZE = 12;
export const TABLE_PAGE_SIZE = 25;

export const pageSizeForView = (view: "cards" | "table"): number =>
  view === "table" ? TABLE_PAGE_SIZE : CARDS_PAGE_SIZE;

export const defaultViewForCount = (count: number): "cards" | "table" =>
  count > CARDS_PAGE_SIZE ? "table" : "cards";

export const paginateRows = <T,>(rows: T[], page: number, pageSize: number) => {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    page: safePage,
    totalPages,
    total,
    start: total === 0 ? 0 : start + 1,
    end,
    slice: rows.slice(start, end)
  };
};

/** Production / registered apps first; test fixtures after, both stable by name. */
export const sortApplicationsForBrowse = (rows: ApplicationRow[]): ApplicationRow[] =>
  [...rows].sort((left, right) => {
    const leftTest = isTestApplication(left) ? 1 : 0;
    const rightTest = isTestApplication(right) ? 1 : 0;
    if (leftTest !== rightTest) return leftTest - rightTest;
    return String(left.name || "").localeCompare(String(right.name || ""), undefined, {
      sensitivity: "base"
    });
  });
