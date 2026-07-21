import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICK_BUDGET_MS,
  JOB_CADENCES,
  computeDueJobs,
  isJobDue,
  resolveCadenceMs,
  resolveTickBudgetMs
} from "./serverless-tick-schedule";

describe("serverless-tick-schedule", () => {
  const now = new Date("2026-07-21T07:00:00.000Z");

  describe("isJobDue", () => {
    it("treats a job with no recorded state as due", () => {
      expect(isJobDue(undefined, now)).toBe(true);
    });

    it("treats a job with a null nextDueAt as due", () => {
      expect(isJobDue({ nextDueAt: null }, now)).toBe(true);
    });

    it("is due when nextDueAt is in the past or exactly now", () => {
      expect(isJobDue({ nextDueAt: new Date(now.getTime() - 1) }, now)).toBe(true);
      expect(isJobDue({ nextDueAt: new Date(now.getTime()) }, now)).toBe(true);
    });

    it("is not due when nextDueAt is in the future", () => {
      expect(isJobDue({ nextDueAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    });
  });

  describe("computeDueJobs", () => {
    it("returns all jobs (in priority order) when no state exists", () => {
      const due = computeDueJobs(JOB_CADENCES, new Map(), now);
      expect(due).toEqual(JOB_CADENCES.map((cadence) => cadence.name));
    });

    it("excludes jobs whose nextDueAt is still in the future", () => {
      const states = new Map(
        JOB_CADENCES.map((cadence) => [cadence.name, { nextDueAt: new Date(now.getTime() + 60_000) }])
      );
      // Only make one job due.
      states.set("runHttpChecksJob", { nextDueAt: new Date(now.getTime() - 1) });

      const due = computeDueJobs(JOB_CADENCES, states, now);
      expect(due).toEqual(["runHttpChecksJob"]);
    });

    it("preserves the configured priority ordering", () => {
      const due = computeDueJobs(JOB_CADENCES, new Map(), now);
      expect(due.indexOf("processHeartbeatStaleJob")).toBeLessThan(due.indexOf("pruneRetentionJob"));
    });
  });

  describe("resolveCadenceMs", () => {
    it("uses the default when the override is unset", () => {
      const cadence = { name: "x", envKey: "WORKER_X_INTERVAL_MS", defaultMs: 60_000 };
      expect(resolveCadenceMs(cadence, {})).toBe(60_000);
    });

    it("honours a valid positive override", () => {
      const cadence = { name: "x", envKey: "WORKER_X_INTERVAL_MS", defaultMs: 60_000 };
      expect(resolveCadenceMs(cadence, { WORKER_X_INTERVAL_MS: "5000" })).toBe(5000);
    });

    it("falls back to the default for invalid or non-positive overrides", () => {
      const cadence = { name: "x", envKey: "WORKER_X_INTERVAL_MS", defaultMs: 60_000 };
      expect(resolveCadenceMs(cadence, { WORKER_X_INTERVAL_MS: "0" })).toBe(60_000);
      expect(resolveCadenceMs(cadence, { WORKER_X_INTERVAL_MS: "-1" })).toBe(60_000);
      expect(resolveCadenceMs(cadence, { WORKER_X_INTERVAL_MS: "abc" })).toBe(60_000);
    });
  });

  describe("resolveTickBudgetMs", () => {
    it("defaults to DEFAULT_TICK_BUDGET_MS", () => {
      expect(resolveTickBudgetMs({})).toBe(DEFAULT_TICK_BUDGET_MS);
    });

    it("honours a positive override", () => {
      expect(resolveTickBudgetMs({ OPSWATCH_WORKER_TICK_BUDGET_MS: "30000" })).toBe(30_000);
    });
  });

  describe("JOB_CADENCES coverage", () => {
    it("has unique job names", () => {
      const names = JOB_CADENCES.map((cadence) => cadence.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("covers the user-requested capabilities", () => {
      const names = new Set(JOB_CADENCES.map((cadence) => cadence.name));
      for (const required of [
        "processHeartbeatStaleJob",
        "runHttpChecksJob",
        "runSslChecksJob",
        "runIncidentCorrelationJob",
        "resolveIncidentsJob",
        "processAlertEscalationJob",
        "evaluateSloBurnRateJob",
        "runIncidentAutoHealJob",
        "runMonitoringSyncJob",
        "runExpireCredentialsJob",
        "runLearningCycleJob",
        "pruneRetentionJob"
      ]) {
        expect(names.has(required)).toBe(true);
      }
    });
  });
});
