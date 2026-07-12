import { redactForPrompt } from "../../lib/redact-secrets";
import { AUTOMATION_PLAYBOOKS } from "./automation-playbooks.seed";
import { selectPlaybookKey } from "./automation-planner.service";

export type LlmPlaybookSelection = {
  playbookKey: string;
  confidence: number;
  reason: string;
  analysisMode: "LLM" | "RULES";
};

const REGISTERED_KEYS = AUTOMATION_PLAYBOOKS.map((row) => row.key);

const isEnabled = (): boolean =>
  process.env.AUTOMATION_LLM_PLANNER_ENABLED === "true" &&
  process.env.INCIDENT_AI_LLM_ENABLED !== "false" &&
  Boolean(process.env.OPENAI_API_KEY?.trim());

export const selectPlaybookWithLlm = async (input: {
  failureClass?: string;
  rootCauseName?: string;
  alertTitles: string[];
  diagnosis: string;
  narrative?: string;
}): Promise<LlmPlaybookSelection> => {
  const rulesFallback = (): LlmPlaybookSelection => {
    const playbookKey = selectPlaybookKey({
      failureClass: input.failureClass,
      rootCauseName: input.rootCauseName,
      alertTitles: input.alertTitles
    });
    return {
      playbookKey,
      confidence: 75,
      reason: "Selected by rules engine fallback.",
      analysisMode: "RULES"
    };
  };

  if (!isEnabled()) return rulesFallback();

  const model = process.env.INCIDENT_AI_LLM_MODEL?.trim() || "gpt-4o-mini";
  const prompt = redactForPrompt({
    task: "Select the most relevant registered automation playbook. Never invent actions or steps.",
    registeredPlaybooks: REGISTERED_KEYS,
    incident: {
      failureClass: input.failureClass,
      rootCauseName: input.rootCauseName,
      alertTitles: input.alertTitles,
      diagnosis: input.diagnosis,
      narrative: input.narrative
    },
    responseSchema: {
      playbookKey: "one of registeredPlaybooks",
      confidence: "0-100",
      reason: "short operator-facing explanation"
    }
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an SRE automation planner. Choose only from registered playbook keys. Never generate executable commands or new remediation actions."
          },
          { role: "user", content: JSON.stringify(prompt) }
        ]
      })
    });

    if (!response.ok) return rulesFallback();

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return rulesFallback();

    const parsed = JSON.parse(content) as {
      playbookKey?: string;
      confidence?: number;
      reason?: string;
    };
    if (!parsed.playbookKey || !REGISTERED_KEYS.includes(parsed.playbookKey)) {
      return rulesFallback();
    }

    return {
      playbookKey: parsed.playbookKey,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 80))),
      reason: parsed.reason?.trim() || "LLM selected registered playbook.",
      analysisMode: "LLM"
    };
  } catch {
    return rulesFallback();
  }
};
