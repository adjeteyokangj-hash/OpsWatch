/**
 * Relationship remediation visual markers (not line colour alone).
 * Used by topology canvas/drawer for Phase 7 state communication.
 */
export type RelationshipRemediationMarker =
  | "failure_confirmed"
  | "repair_running"
  | "verification_running"
  | "recovery_verified"
  | "repair_failed"
  | "evidence_stale"
  | "none";

export const resolveRelationshipRemediationMarker = (input: {
  edgeStatus?: string | null;
  runStatus?: string | null;
  evidenceFresh?: boolean;
}): RelationshipRemediationMarker => {
  const run = String(input.runStatus || "").toUpperCase();
  if (["EXECUTING", "EXECUTED", "ROLLBACK_RUNNING"].includes(run)) return "repair_running";
  if (run === "VERIFYING") return "verification_running";
  if (run === "VERIFIED_HEALTHY") return "recovery_verified";
  if (["VERIFICATION_FAILED", "ROLLBACK_FAILED", "DEAD_LETTER", "FAILED"].includes(run)) {
    return "repair_failed";
  }
  if (input.evidenceFresh === false) return "evidence_stale";
  const edge = String(input.edgeStatus || "").toUpperCase();
  if (edge === "CRITICAL" || edge === "DEGRADED" || edge === "DOWN") return "failure_confirmed";
  return "none";
};

export const relationshipMarkerLabel = (marker: RelationshipRemediationMarker): string => {
  switch (marker) {
    case "failure_confirmed":
      return "Failure confirmed";
    case "repair_running":
      return "Repair running";
    case "verification_running":
      return "Verification running";
    case "recovery_verified":
      return "Recovery verified";
    case "repair_failed":
      return "Repair or verification failed";
    case "evidence_stale":
      return "Evidence stale or unavailable";
    default:
      return "No remediation marker";
  }
};
