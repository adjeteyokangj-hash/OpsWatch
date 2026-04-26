import { Router } from "express";
import {
  getProductInsights,
  getInsightRecommendations,
  getInsightActionRuns,
  getInsightApprovals,
  applyRecommendationById,
  approveRecommendationById,
  dismissRecommendationById,
  installMonitoringProfile,
  createJourneyFromTemplate,
  applyInsightRecommendation,
} from "../controllers/product-insights.controller";

export const productInsightsRouter = Router();

// Read
productInsightsRouter.get("/insights/product",              getProductInsights);
productInsightsRouter.get("/insights/recommendations",       getInsightRecommendations);
productInsightsRouter.get("/insights/action-runs",           getInsightActionRuns);
productInsightsRouter.get("/insights/approvals",             getInsightApprovals);

// Write — per-recommendation actions
productInsightsRouter.post("/insights/recommendations/:id/apply",   applyRecommendationById);
productInsightsRouter.post("/insights/recommendations/:id/approve", approveRecommendationById);
productInsightsRouter.post("/insights/recommendations/:id/dismiss", dismissRecommendationById);

// Profile installer
productInsightsRouter.post("/insights/profiles/:id/install", installMonitoringProfile);

// Journey templates
productInsightsRouter.post("/insights/journeys/templates/:key/create", createJourneyFromTemplate);

// Legacy body-based apply (backward compat)
productInsightsRouter.post("/insights/recommendations/apply", applyInsightRecommendation);
