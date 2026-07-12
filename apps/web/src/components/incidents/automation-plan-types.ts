export type AutomationPlanStep = {
  order: number;
  action: string;
  targetServiceId?: string;
  targetServiceName?: string;
  approvalRequired: boolean;
  description: string;
  rationale?: string;
  rollbackAvailable?: boolean;
  status?: string;
};

export type AutomationPlan = {
  playbookKey: string;
  playbookVersion: number;
  analysisMode: string;
  confidence: number;
  riskLevel: string;
  executionMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  reason: string;
  steps: AutomationPlanStep[];
  runId?: string;
};

export type AutomationRunDetails = {
  id: string;
  incidentId: string;
  playbookKey: string;
  playbookVersion: number;
  executionMode: AutomationPlan["executionMode"];
  status: string;
  riskLevel?: string;
  reason?: string;
  currentStepOrder?: number | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  approvalReason?: string | null;
  approvalDecision?: string | null;
  plan: AutomationPlan;
  steps: AutomationPlanStep[];
  outcome?: {
    summary: string;
    success: boolean;
    details?: {
      succeeded?: number;
      failed?: number;
      skipped?: number;
    };
  } | null;
};
