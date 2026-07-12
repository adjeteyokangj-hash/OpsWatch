import { z } from "zod";

export const INCIDENT_DIAGNOSIS_CATEGORIES = [
  "AVAILABILITY",
  "RELIABILITY",
  "PERFORMANCE",
  "SECURITY",
  "DEPENDENCY_CHANGE"
] as const;

export type IncidentDiagnosisCategory = (typeof INCIDENT_DIAGNOSIS_CATEGORIES)[number];

export const incidentLlmDiagnosisSchema = z.object({
  diagnosis: z.string().trim().min(10).max(4000),
  rootCauseHypothesis: z.string().trim().min(5).max(2000),
  confidence: z.number().min(0).max(1),
  category: z.enum(INCIDENT_DIAGNOSIS_CATEGORIES)
});

export type IncidentLlmDiagnosis = z.infer<typeof incidentLlmDiagnosisSchema>;

export const parseIncidentLlmDiagnosis = (
  value: unknown
): { success: true; data: IncidentLlmDiagnosis } | { success: false; error: string } => {
  const parsed = incidentLlmDiagnosisSchema.safeParse(value);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
  };
};

export const automationPlaybookLlmSchema = z.object({
  playbookKey: z.string().trim().min(1).max(120),
  confidence: z.number().min(0).max(100),
  rationale: z.string().trim().min(5).max(1000).optional()
});

export type AutomationPlaybookLlmSelection = z.infer<typeof automationPlaybookLlmSchema>;

export const parseAutomationPlaybookLlmSelection = (
  value: unknown
): { success: true; data: AutomationPlaybookLlmSelection } | { success: false; error: string } => {
  const parsed = automationPlaybookLlmSchema.safeParse(value);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
  };
};
