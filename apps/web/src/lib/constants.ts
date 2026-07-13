import { CLIENT_API_BASE_URL } from "./api-origin";

export const APP_NAME = "OpsWatch";

const DIRECT_API_BASE_URL = "http://localhost:4000/api";

/** Same-origin /api proxy — keeps HttpOnly session cookies on the web host. */
export const API_BASE_URL = CLIENT_API_BASE_URL;

/** Direct API URL for cases that cannot use the Next.js proxy (e.g. e2e against raw API). */
export const DIRECT_API_URL = DIRECT_API_BASE_URL;
