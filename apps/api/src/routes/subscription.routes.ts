import { Router } from "express";
import {
  assignOrganizationSubscription,
  createSubscriptionCheckout,
  createSubscriptionPortal,
  getOrganizationSubscription
} from "../controllers/subscription.controller";
import { requireRole } from "../middleware/require-role";

export const subscriptionRouter = Router();

subscriptionRouter.get("/subscription", getOrganizationSubscription);
subscriptionRouter.post("/subscription/assign", requireRole("ADMIN"), assignOrganizationSubscription);
subscriptionRouter.post("/subscription/checkout", requireRole("ADMIN"), createSubscriptionCheckout);
subscriptionRouter.post("/subscription/portal", requireRole("ADMIN"), createSubscriptionPortal);
