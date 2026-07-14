const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** NextResponse/Fetch forbid a body for null-body HTTP statuses. */
export const resolveEmbeddedResponseBody = (status: number, text: string): string | null =>
  NULL_BODY_STATUSES.has(status) ? null : text;
