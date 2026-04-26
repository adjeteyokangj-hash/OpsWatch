import { Router } from "express";
import {
	getOrg,
	createOrg,
	patchOrg,
	listStatusPages,
	createStatusPage,
	listApiKeys,
	createApiKey,
	revokeApiKey,
	getApiKeyUsage
} from "../controllers/org.controller";

export const orgRouter = Router();

orgRouter.get("/org", getOrg);
orgRouter.post("/org", createOrg);
orgRouter.patch("/org", patchOrg);
orgRouter.get("/org/status-pages", listStatusPages);
orgRouter.post("/org/status-pages", createStatusPage);
orgRouter.get("/org/api-keys", listApiKeys);
orgRouter.get("/org/api-keys/usage", getApiKeyUsage);
orgRouter.post("/org/api-keys", createApiKey);
orgRouter.post("/org/api-keys/:keyId/revoke", revokeApiKey);
