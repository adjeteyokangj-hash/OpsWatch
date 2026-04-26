/* eslint-disable no-console */
export const logger = {
  info: (...args: unknown[]): void => console.log("[opswatch-worker]", ...args),
  warn: (...args: unknown[]): void => console.warn("[opswatch-worker]", ...args),
  error: (...args: unknown[]): void => console.error("[opswatch-worker]", ...args)
};
