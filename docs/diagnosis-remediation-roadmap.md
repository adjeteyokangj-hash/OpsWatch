# Monitoring Diagnosis and Remediation Roadmap

This guide answers three practical questions for OpsWatch:

- What additional monitoring features should be added next?
- How can the system diagnose incidents better?
- Which tools and actions can OpsWatch use to fix problems safely?

It is aligned to the current codebase (API, worker, Prisma models, remediation executors, and existing scripts).

## 1) Current Capabilities Already in OpsWatch

OpsWatch already includes more than baseline monitoring.

### Monitoring and Alerting

- HTTP, SSL, keyword, and response-time checks
- Heartbeat stale detection
- Alert lifecycle with triggered and resolved transitions
- Incident creation and resolution flow
- Notification channels and delivery testing

### Diagnosis

- Rule-based diagnosis engine in API service layer
- Categorized incident reasoning (availability, reliability, performance, security, dependency/change)
- Action suggestions from diagnosis output

### Remediation and Guardrails

- Action registry with safety tiers and required context checks
- Execution modes: manual, approved, automatic
- Approval gating for medium/high impact actions
- Auto-remediation policy hierarchy (global, project, action)
- Auto-run allowlist and cooldown windows
- Confidence scoring and historical success-rate signal
- Remediation logs and basic accuracy metrics

## 2) What to Add Next (Priority Order)

### P0: Improve Signal Correlation and Root Cause Accuracy

1. Add deployment and config change timeline events.
2. Add dependency graph between services and providers.
3. Add incident timeline view (first failing check, first error spike, last deploy, rollback status).
4. Add root-cause candidate scoring with confidence bands.

Why first: this improves diagnosis quality before adding more automation risk.

### P1: Expand Detection Coverage

1. Synthetic business journeys (login, checkout, payment complete, notification send).
2. SLI and SLO tracking with burn-rate alerts.
3. Queue depth and job age checks for worker health.
4. Database health expansion (connection pool saturation, lock/wait, slow query count).
5. Third-party provider health ingestion (status API polling).

### P2: Expand Safe Auto-Remediation

1. Auto retry with bounded attempts and jitter for transient failures.
2. Worker recycle action with strict cooldown and blast-radius limits.
3. One-click rollback request workflow with mandatory approval and evidence bundle.
4. Feature-flag kill switch integration for fast containment.

### P3: Improve Operator Experience

1. Runbook-linked alert cards with context-aware deep links.
2. Duplicate alert suppression windows.
3. Maintenance mode and change freeze windows.
4. Incident postmortem export with remediation and timeline summary.

## 3) Diagnosis Tooling: Internal vs External

### Internal (native OpsWatch)

- Rule-based incident diagnosis service
- Event, alert, incident, check, and heartbeat history in PostgreSQL
- Remediation confidence and policy snapshots in remediation logs

### External Observability Tools to Integrate

1. OpenTelemetry
   - Use for traces and metric/log correlation IDs.
2. Prometheus plus Alertmanager (or managed equivalent)
   - Use for SLO math, burn-rate alerting, and capacity trends.
3. Grafana
   - Use for dashboards and alert-to-dashboard deep links.
4. Loki or ELK/OpenSearch
   - Use for centralized structured logs and failure signatures.
5. Sentry
   - Use for exception grouping and release-aware regressions.

## 4) Fix Tooling: Actions OpsWatch Can Execute

### Safe and Low Risk

- Retry webhooks
- Retry emails
- Requeue failed job
- Rerun HTTP check
- Rerun SSL check
- Acknowledge incident
- Add incident note

### Approval Required

- Restart worker
- Restart service
- Rollback deployment
- Disable integration
- Rotate webhook secret

### Support and Escalation

- Check provider status
- Open runbook
- Request human review

## 5) Implementation Backlog (Repo-Oriented)

Use this as a direct execution backlog.

### Epic A: Correlation and Root Cause

1. Schema
   - Add ChangeEvent table (deploy/config/migration/feature-flag).
   - Add ServiceDependency edges.
   - Add IncidentTimelineEvent records.
2. API
   - New endpoints to ingest/list change events.
   - Incident endpoint to return ranked root-cause candidates.
3. Worker
   - Correlation job that links failing checks to recent changes and dependencies.
4. Web
   - Incident timeline panel and root-cause score card.

### Epic B: SLO and Synthetic Monitoring

1. Schema
   - Add SLODefinition and SLOWindow aggregates.
   - Reuse SyntheticJourney for scheduled execution records.
2. Worker
   - Add synthetic-run scheduler and result persistence.
   - Add burn-rate evaluator job.
3. API
   - SLO dashboards and synthetic result APIs.
4. Web
   - SLO status widgets and budget burn indicators.

### Epic C: Guarded Auto-Remediation Expansion

1. Policy
   - Keep allowlist-first model.
   - Add per-action max attempts per incident.
2. Execution
   - Add action simulation (dry-run) endpoint.
   - Add pre-flight validator output to UI.
3. Safety
   - Add blast-radius controls (project and service criticality aware).
   - Add hard stop on repeated failure loops.

### Epic D: Runbooks and Operations UX

1. Add runbook metadata table and ownership fields.
2. Add runbook routing by alert category and service type.
3. Add incident export endpoint for postmortem generation.

## 6) Recommended Verification for Each Milestone

Run these checks after each phase rollout:

- pnpm quarantine:verify-monitoring
- pnpm quarantine:verify-notifications
- pnpm quarantine:dashboard-smoke

Add new phase checks:

- Correlation E2E: failing check plus recent deploy must surface deploy as top candidate.
- Auto-run safety E2E: blocked actions must remain pending approval.
- Cooldown E2E: repeated action inside cooldown window must be denied.

## 7) Practical 30-60-90 Day Plan

### Day 0-30

- Implement change events and dependency graph.
- Ship incident timeline API and UI.
- Add provider status ingestion.

### Day 31-60

- Add SLO model, burn-rate evaluation, and dashboards.
- Launch synthetic journeys for top 2 business-critical paths.

### Day 61-90

- Expand auto-remediation with dry-run plus blast-radius controls.
- Add postmortem export and runbook ownership workflows.

## 8) Decision Rules for Automatic Actions

Automatic execution should only run when all are true:

1. Action is in allowlist.
2. Policy allows at organization/project/action levels.
3. Context and integration checks pass.
4. Confidence label is HIGH.
5. Cooldown and suppression checks pass.
6. No active maintenance window exists.

If any rule fails, fallback is to queue pending approval with an explicit reason.
