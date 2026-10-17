/** Public Supabase reachability for NiiNai. No API key and no database login. */

export const NIINAI_PROJECT_SLUG = "niinai-guest-house";
export const NIINAI_PROJECT_NAME = "NiiNai Guest House";
export const NIINAI_CLOUD_SERVICE_NAME = "NiiNai Cloud";
export const NIINAI_SUPABASE_ORIGIN = "https://ojmfvcvijgxboohpnfdu.supabase.co";
export const NIINAI_SUPABASE_HEALTH_URL = `${NIINAI_SUPABASE_ORIGIN}/auth/v1/health`;

/**
 * The public auth health route answers 401 when no API key is sent.
 * Any HTTP response below 500 means the host answered. 500 and connection
 * failures remain check failures. This is reachability, not a database query.
 */
export const NIINAI_REACHABILITY_STATUS = {
  acceptedStatusMin: 200,
  acceptedStatusMax: 499
} as const;

export const niinaiReachabilityConfig = () => ({
  monitoringRole: "PUBLIC" as const,
  targetUrl: NIINAI_SUPABASE_HEALTH_URL,
  purpose: "supabase-https-reachability",
  credentials: "none",
  ...NIINAI_REACHABILITY_STATUS
});
