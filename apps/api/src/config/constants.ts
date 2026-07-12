export const API_PREFIX = "/api";
export const REQUEST_ID_HEADER = "x-request-id";
export const PROJECT_KEY_HEADER = "x-opswatch-project-key";
export const TIMESTAMP_HEADER = "x-opswatch-timestamp";
export const NONCE_HEADER = "x-opswatch-nonce";
export const SIGNATURE_HEADER = "x-opswatch-signature";

export const INGEST_ERROR_CODES = {
  SIGNING_UNAVAILABLE: "INGEST_SIGNING_UNAVAILABLE",
  AUTH_INVALID: "INGEST_AUTH_INVALID",
  STALE: "INGEST_STALE",
  REPLAY: "INGEST_REPLAY"
} as const;
