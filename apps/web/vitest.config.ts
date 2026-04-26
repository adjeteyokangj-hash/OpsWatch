import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    clearMocks: true,
    mockReset: true
  }
});
