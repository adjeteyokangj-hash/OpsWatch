import { Router } from "express";
import {
  enableAiLedHandler,
  getAiAutomationPoliciesHandler,
  getAiLedReadinessHandler,
  patchAiAutomationDocumentHandler,
  patchEmergencyStopHandler,
  patchOrganizationCeilingHandler,
  rollbackPolicyHandler,
  simulateAiOperationsHandler
} from "../controllers/ai-automation-policies.controller";

export const aiAutomationPoliciesRouter = Router();

aiAutomationPoliciesRouter.get(
  "/settings/ai-automation-policies",
  getAiAutomationPoliciesHandler
);
aiAutomationPoliciesRouter.get(
  "/settings/ai-automation-policies/readiness",
  getAiLedReadinessHandler
);
aiAutomationPoliciesRouter.post(
  "/settings/ai-automation-policies/enable-ai-led",
  enableAiLedHandler
);
aiAutomationPoliciesRouter.patch(
  "/settings/ai-automation-policies/organization-ceiling",
  patchOrganizationCeilingHandler
);
aiAutomationPoliciesRouter.patch(
  "/settings/ai-automation-policies/emergency-stop",
  patchEmergencyStopHandler
);
aiAutomationPoliciesRouter.post(
  "/settings/ai-automation-policies/rollback",
  rollbackPolicyHandler
);
aiAutomationPoliciesRouter.post(
  "/settings/ai-automation-policies/simulate",
  simulateAiOperationsHandler
);
aiAutomationPoliciesRouter.patch(
  "/settings/ai-automation-policies/document",
  patchAiAutomationDocumentHandler
);
