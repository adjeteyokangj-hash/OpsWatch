import { assertProductionEnv } from "./config/production-env";

let bootstrapped = false;

/** Shared startup guard for long-running server and Vercel serverless entry. */
export const bootstrapApi = (): void => {
  if (bootstrapped) {
    return;
  }
  assertProductionEnv();
  bootstrapped = true;
};
