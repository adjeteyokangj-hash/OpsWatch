import { NIINAI_DIRECTORY_URL_ENV, redactMonitoringSecret, withNiinaiMonitoringClient } from "./niinai-directory-sync";
import { hashMonitoringTicket, monitoringTicket } from "./user-monitoring";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The database function expects the SHA-256 hex of the ticket, never the ticket itself. */
const REDEEM_SQL = "select public.monitoring_redeem_ticket($1::text) as user_id";

const userIdFrom = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  return UUID_PATTERN.test(raw) ? raw : null;
};

/**
 * Redeem a one-time NiiNai monitoring ticket.
 * A failed or repeated ticket returns null and does not change staff or business records.
 */
export const redeemNiinaiMonitoringTicket = async (
  ticket: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    redeem?: (ticketHash: string) => Promise<unknown>;
  }
): Promise<string | null> => {
  const opaque = monitoringTicket(ticket);
  if (!opaque) return null;
  const ticketHash = hashMonitoringTicket(opaque);
  const env = options?.env ?? process.env;
  const connectionString = env[NIINAI_DIRECTORY_URL_ENV]?.trim() ?? "";
  if (!connectionString && !options?.redeem) return null;

  try {
    const returned = options?.redeem
      ? await options.redeem(ticketHash)
      : await withNiinaiMonitoringClient(connectionString, async (client) => {
          const result = await client.query(REDEEM_SQL, [ticketHash]);
          const row = result.rows[0] as { user_id?: unknown } | undefined;
          return row?.user_id ?? null;
        });
    return userIdFrom(returned);
  } catch (error) {
    const message = error instanceof Error ? error.message : "NiiNai ticket redemption failed";
    console.error(redactMonitoringSecret(message, connectionString));
    return null;
  }
};
