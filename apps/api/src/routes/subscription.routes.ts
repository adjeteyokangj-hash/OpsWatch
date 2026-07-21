import { Router } from "express";
import {
  assignOrganizationSubscription,
  getOrganizationSubscription
} from "../controllers/subscription.controller";
import { rejectGlobalWorkspaceBilling } from "../controllers/global-billing-removed";
import { requireRole } from "../middleware/require-role";

export const subscriptionRouter = Router();

// Read-only entitlement summary. Retained only as an internal / Super Admin
// overview of the organisation's effective entitlements. It does not sell,
// purchase, or manage a workspace subscription.
subscriptionRouter.get("/subscription", getOrganizationSubscription);

// Internal plan assignment (no money movement, admin only). Retained so the
// entitlement engine can be seeded/adjusted; it is not exposed in the product UI.
subscriptionRouter.post("/subscription/assign", requireRole("ADMIN"), assignOrganizationSubscription);

// Global workspace subscription purchase / manage has been removed. Billing is
// per application — see POST/GET /projects/:projectId/billing. These endpoints
// no longer initiate or manage a single global OpsWatch subscription.
subscriptionRouter.post("/subscription/checkout", rejectGlobalWorkspaceBilling);
subscriptionRouter.post("/subscription/portal", rejectGlobalWorkspaceBilling);
