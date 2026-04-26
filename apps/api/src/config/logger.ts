const format = (level: string, args: unknown[]) => {
  const ts = new Date().toISOString();
  return [`[${ts}]`, `[${level}]`, ...args];
};

export const logger = {
  info: (...args: unknown[]) => console.log(...format("INFO", args)),
  warn: (...args: unknown[]) => console.warn(...format("WARN", args)),
  error: (...args: unknown[]) => console.error(...format("ERROR", args)),
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(...format("DEBUG", args));
    }
  }
};
