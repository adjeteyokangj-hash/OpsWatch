import { assertProductionEnv } from "./config/production-env";
import { redactMonitoringSecret, syncNiinaiStaffDirectory } from "./services/niinai-directory-sync";
import { redeemNiinaiMonitoringTicket } from "./services/niinai-ticket-redeem";
import { setMonitoringTicketVerifier } from "./services/user-monitoring";

let bootstrapped = false;
let directorySync: Promise<void> | null = null;
let directorySyncedAt = 0;
const DIRECTORY_REFRESH_MS = 5 * 60 * 1000;

/** Pull the staff directory at most once every five minutes for this process. */
export const ensureNiinaiDirectoryFresh = (): Promise<void> => {
  if (Date.now() - directorySyncedAt < DIRECTORY_REFRESH_MS) {
    return Promise.resolve();
  }
  if (!directorySync) {
    directorySync = syncNiinaiStaffDirectory()
      .then((result) => {
        if (result.status === "SYNCED") directorySyncedAt = Date.now();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "NiiNai directory sync failed";
        console.error(redactMonitoringSecret(message, process.env.NIINAI_MONITORING_DATABASE_URL));
      })
      .finally(() => {
        directorySync = null;
      });
  }
  return directorySync;
};

/** Shared startup guard for long-running server and Vercel serverless entry. */
export const bootstrapApi = (): void => {
  if (bootstrapped) {
    return;
  }
  assertProductionEnv();
  bootstrapped = true;
  setMonitoringTicketVerifier((ticket) => redeemNiinaiMonitoringTicket(ticket));
  void ensureNiinaiDirectoryFresh();
};
