import { Router } from "express";
import {
  disconnectPlatformStripe,
  getLegacyProjectStripeIntegrations,
  getPlatformStripe,
  savePlatformStripe,
  validatePlatformStripe
} from "../controllers/platform-stripe.controller";
import { requirePlatformSuperAdmin } from "../middleware/require-platform-super-admin";

export const adminBillingRouter = Router();

// This router is mounted at /api alongside other feature routers. Restrict
// the platform-only gate to its own routes so unrelated requests can continue.
adminBillingRouter.use("/admin/billing/stripe", requirePlatformSuperAdmin);

adminBillingRouter.get("/admin/billing/stripe", getPlatformStripe);
adminBillingRouter.put("/admin/billing/stripe", savePlatformStripe);
adminBillingRouter.post("/admin/billing/stripe/validate", validatePlatformStripe);
adminBillingRouter.post("/admin/billing/stripe/disconnect", disconnectPlatformStripe);
adminBillingRouter.get("/admin/billing/stripe/legacy-integrations", getLegacyProjectStripeIntegrations);
