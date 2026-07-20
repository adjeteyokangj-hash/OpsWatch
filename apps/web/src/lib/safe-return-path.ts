/** Allow only same-origin relative paths (no protocol-relative //…). */
export const safeReturnPath = (value: string | null | undefined): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

/** Parse comma-separated highlight names from a query param (never secret values). */
export const parseHighlightNames = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};