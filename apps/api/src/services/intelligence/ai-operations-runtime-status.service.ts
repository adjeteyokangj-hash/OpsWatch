import type {
  AiOperationsStatusPayload,
  OpsStatusCapability,
  OpsStatusTone
} from "./ai-operations-status.service";
import type { WorkerRuntimeStatus } from "../worker-tick/worker-runtime-status.service";

const capabilityById = (
  status: AiOperationsStatusPayload,
  id: string
): OpsStatusCapability | undefined => status.capabilities.find((capability) => capability.id === id);

const isAiLedStatus = (status: AiOperationsStatusPayload): boolean => {
  const overall = capabilityById(status, "overall_mode");
  const profile = String(overall?.evidence?.profile ?? "").toLowerCase();
  return /^ai-led/i.test(status.overall.modeLabel) || profile === "ai_led_safe";
};

const worstTone = (...tones: OpsStatusTone[]): OpsStatusTone => {
  if (tones.includes("red")) return "red";
  if (tones.includes("amber")) return "amber";
  return "green";
};

/**
 * Replace legacy application-heartbeat evidence with real worker runtime proof and
 * then recalculate the overall label from the same capabilities the UI displays.
 */
export const mergeAiOperationsRuntimeStatus = (
  status: AiOperationsStatusPayload,
  worker: WorkerRuntimeStatus
): AiOperationsStatusPayload => {
  const capabilities = status.capabilities.some((capability) => capability.id === "worker_heartbeat")
    ? status.capabilities.map((capability) =>
        capability.id === "worker_heartbeat" ? worker.capability : capability
      )
    : [worker.capability, ...status.capabilities];

  const mergedStatus: AiOperationsStatusPayload = { ...status, capabilities };
  const prediction = capabilityById(mergedStatus, "prediction_engine");
  const learning = capabilityById(mergedStatus, "learning_engine");
  const lastDecision = capabilityById(mergedStatus, "last_ai_decision");
  const aiLed = isAiLedStatus(mergedStatus);

  let modeLabel = status.overall.modeLabel;
  let tone = worstTone(status.overall.tone, worker.capability.tone);
  let summary = status.overall.summary;

  if (aiLed) {
    if (worker.capability.tone === "red") {
      modeLabel = "AI configured — worker unavailable";
      tone = "red";
      summary = worker.capability.summary;
    } else if (prediction?.tone === "red") {
      modeLabel = "AI configured — predictions off";
      tone = "red";
      summary = prediction.summary;
    } else if (learning?.tone === "red") {
      modeLabel = "AI configured — learning off";
      tone = "red";
      summary = learning.summary;
    } else if (worker.capability.tone === "amber" || lastDecision?.tone !== "green") {
      modeLabel = "AI configured — waiting for evidence";
      tone = "amber";
      summary =
        worker.capability.tone === "amber"
          ? worker.capability.summary
          : lastDecision?.summary ?? "AI is configured and waiting for operational evidence.";
    } else if (prediction?.tone === "amber" || learning?.tone === "amber") {
      modeLabel = "AI operations — building evidence";
      tone = "amber";
      summary = "AI operations are running; one capability is still building evidence.";
    } else {
      modeLabel = "AI operations active";
      tone = "green";
      summary = "Worker runtime, learning and AI decision evidence are active.";
    }
  } else if (worker.capability.tone === "red") {
    modeLabel = "Safety-gated — worker unavailable";
    tone = "red";
    summary = worker.capability.summary;
  }

  const blocked = [
    ...status.blocked.filter((row) => row.id !== "worker_heartbeat"),
    ...worker.blocked
  ];

  return {
    ...status,
    overall: { modeLabel, tone, summary },
    capabilities,
    blocked
  };
};
