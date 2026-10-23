import type { AiOperationsStatusPayload } from "./ai-operations-status.service";
import type { WorkerRuntimeStatus } from "../worker-tick/worker-runtime-status.service";

export const unavailableOperationsStatus = (): AiOperationsStatusPayload => ({
  asOf: new Date().toISOString(),
  overall: { modeLabel: "Capability evidence unavailable", tone: "amber", summary: "Capability queries failed. Configuration and evidence state cannot be verified; this does not mean AI is disabled." },
  lastAiDecision: { at: null, summary: null, kind: null }, recentDecisions: [],
  capabilities: [{ id: "capability_load_error", label: "Capability evidence", tone: "amber", lastEvidenceAt: null,
    summary: "Capability evidence could not be loaded. Retry and inspect server diagnostics.", evidence: { state: "LOAD_ERROR" } }],
  blocked: [{ id: "capability_load_error", label: "Capability evidence", reason: "Status data unavailable" }]
});
export const unavailableWorkerStatus = (): WorkerRuntimeStatus => ({
  capability: { id: "worker_heartbeat", label: "Worker runtime", tone: "amber", lastEvidenceAt: null,
    summary: "Worker runtime evidence could not be loaded. Worker health is unknown.", evidence: { state: "LOAD_ERROR" } },
  blocked: [{ id: "worker_load_error", label: "Worker runtime", reason: "Worker runtime query unavailable" }]
});
