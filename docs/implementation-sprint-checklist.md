# OpsWatch Implementation Sprint Checklist

Use this checklist to run Epic A + P1 delivery in repeatable weekly sprints.

## Sprint Setup

- [ ] Confirm sprint owner and on-call reviewer
- [ ] Confirm target environment (dev/staging/prod)
- [ ] Confirm rollback owner for schema and worker releases
- [ ] Confirm required secrets and integration keys are available
- [ ] Confirm success metrics for this sprint are documented

## Epic A: Correlation and Root Cause

### A1. Schema and Migration

- [ ] Add and review `ChangeEvent` schema
- [ ] Add and review `ServiceDependency` schema
- [ ] Add and review `IncidentTimelineEvent` schema
- [ ] Run migration in staging and record migration ID
- [ ] Validate indexes with `EXPLAIN` on main read paths

### A2. API Endpoints

- [ ] Add project change-event ingest endpoint
- [ ] Add project change-event list endpoint
- [ ] Add incident timeline endpoint
- [ ] Add incident root-cause candidate endpoint
- [ ] Add auth and org boundary tests

### A3. Worker Correlation Job

- [ ] Add incident correlation job schedule
- [ ] Correlate incident with alerts into timeline
- [ ] Correlate incident with nearby change events
- [ ] Correlate incident with dependency edges
- [ ] Add job logging and failure handling

### A4. Verification

- [ ] Create test change event and verify it appears in timeline
- [ ] Create dependency edge and verify candidate ranking includes it
- [ ] Verify non-org project access is denied
- [ ] Verify timeline endpoint returns deterministic ordering

## P1: SLO and Burn Rate Foundations

### P1.1 Schema and Model

- [ ] Add `SLODefinition` schema
- [ ] Add `SLOWindow` schema
- [ ] Add migration and indexes
- [ ] Seed at least one SLO definition in staging

### P1.2 Worker Evaluator

- [ ] Add burn-rate evaluator job schedule
- [ ] Compute availability/error rate window aggregates
- [ ] Compute p95 latency for latency SLI definitions
- [ ] Persist SLO window status (`HEALTHY`, `AT_RISK`, `BREACHING`)
- [ ] Add guard for empty sample windows

### P1.3 Verification

- [ ] Simulate failing checks and validate burn-rate rises
- [ ] Simulate healthy checks and validate burn-rate normalizes
- [ ] Verify one SLO window row per definition per evaluation window

## Release Gate

- [ ] Run `pnpm quarantine:verify-monitoring`
- [ ] Run `pnpm quarantine:verify-notifications`
- [ ] Run `pnpm quarantine:dashboard-smoke`
- [ ] Confirm no new high-severity lint/typecheck errors
- [ ] Confirm incident response runbook links are present

## Post-Release Review

- [ ] Capture what worked and what failed in sprint retrospective
- [ ] Update runbooks with new diagnosis/fix learnings
- [ ] Track false positive rate for root-cause candidates
- [ ] Track auto-remediation block reasons for tuning
