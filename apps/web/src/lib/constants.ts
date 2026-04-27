export const APP_NAME = "OpsWatch";

const LOCAL_API_BASE_URL = "http://localhost:4000/api";
const PRODUCTION_API_BASE_URL = "https://opswatch-api-production-3bc7.up.railway.app/api";

export const API_BASE_URL =
	process.env.NEXT_PUBLIC_OPSWATCH_API_URL ||
	(process.env.NODE_ENV === "production" ? PRODUCTION_API_BASE_URL : LOCAL_API_BASE_URL);
