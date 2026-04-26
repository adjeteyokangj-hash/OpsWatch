import type { RemediationExecutor } from "../types";
import { completed, unsupported } from "./_common";

const RUNBOOK_BASE_URL = process.env.RUNBOOK_BASE_URL;

export const executeOpenRunbook: RemediationExecutor = async ({ context }) => {
  if (!RUNBOOK_BASE_URL) {
    return unsupported("Runbook URL is not configured. Set RUNBOOK_BASE_URL.");
  }

  const slug = context.extra?.runbookSlug || "default";
  const url = `${RUNBOOK_BASE_URL.replace(/\/$/, "")}/${slug}`;

  return completed("Runbook link prepared.", { runbookUrl: url });
};
