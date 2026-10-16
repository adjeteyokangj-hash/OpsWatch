/**
 * Shared list pagination for org-scoped collection endpoints.
 * Caps unbounded payloads that previously timed out the dashboard (30s client abort).
 */

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

export type ListPagination = {
  take: number;
  skip: number;
};

export const resolveListPagination = (input: {
  limit?: unknown;
  offset?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}): ListPagination => {
  const defaultLimit = input.defaultLimit ?? DEFAULT_LIST_LIMIT;
  const maxLimit = input.maxLimit ?? MAX_LIST_LIMIT;
  const rawLimit =
    typeof input.limit === "string" || typeof input.limit === "number"
      ? Number(input.limit)
      : defaultLimit;
  const rawOffset =
    typeof input.offset === "string" || typeof input.offset === "number"
      ? Number(input.offset)
      : 0;

  const take = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)))
    : defaultLimit;
  const skip = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { take, skip };
};
