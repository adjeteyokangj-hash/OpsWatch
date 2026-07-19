# OpsWatch Observability Programme

This document defines the mandatory delivery order for OpsWatch. It is an
engineering dependency sequence, not a list of parallel workstreams.

## Current product position

OpsWatch is an:

> Agentless application-health and incident-remediation platform with an
> advanced topology foundation.

OpsWatch must not currently be described as Datadog-class or Dynatrace-class.

## Mandatory delivery order

Work must progress through these phases in order:

1. **URL-only onboarding**
   - Create persistent public/admin URL connections and external HTTP/SSL
     checks directly from application onboarding.
   - Prove registration through worker execution, stored results, health,
     alerts, recovery, and UI evidence without an agent or heartbeat.
2. **Credential-security gaps**
   - Put webhook and OpenTelemetry secrets in managed encrypted storage.
   - Enforce API-key expiry and prove rotation and revocation.
   - Stop returning plaintext project signing secrets.
3. **OpenTelemetry into alerts, incidents, and topology**
   - Normalize OTEL signals into the operational spine.
   - Add correlation, retention, freshness, and topology effects.
4. **Unify topology models**
   - Use one entity and relationship model in the product UI.
   - Remove or formally deprecate the unused graph.
5. **Replace cosmetic or unverified features**
   - Implement real historical topology replay or remove the replay claim.
   - Execute synthetic journeys or label them as drafts.
6. **Logs and APM foundations**
   - Add searchable logs and trace storage.
   - Measure request latency, throughput, and errors.
   - Correlate services and dependencies.
7. **Expand verified remediation**
   - Add real actions beyond `restart_sync_worker`.
   - Prove approvals, rollback/recovery verification, and provider capability
     registration.
8. **Security and threat foundation**
   - Add security-event ingestion, identity/authentication baselines, API abuse
     and privilege-change detection, findings/incidents, evidence-based risk
     scoring, and approved containment.
9. **Learning and prediction**
   - Activate only after sufficient real data exists.
   - Build behavior baselines, recurring sequences, anomaly scoring,
     prediction candidates, and remediation-outcome feedback.
10. **Native Datadog and Dynatrace connectors**
    - Begin only after the generic polling, pagination, managed-secret,
      normalization, synchronization, and observability foundations are
      complete and verified.

## Non-negotiable gates

- Native Datadog and Dynatrace connector work must not begin before phases
  1–9 establish and verify the generic connection synchronization and
  observability foundations.
- UI placeholders, seeded data, interfaces, schemas, and provider catalogs do
  not count as implemented capabilities.
- Every phase requires acceptance tests, runtime evidence, and a local commit
  before the next phase starts.
- Do not describe unverified work as complete.
- Do not push, deploy, or modify production without explicit user approval.
- Do not advance a phase because only its API or UI path works. Verify the
  complete persisted runtime path and relevant failure/recovery behavior.

## Phase completion record

For every phase, record:

1. Acceptance criteria and their pass/fail state.
2. Exact automated test commands, counts, and exit codes.
3. Runtime evidence, including browser evidence where the feature is visible.
4. Database/migration effects and security controls.
5. Known limitations and deferred work.
6. Local commit SHA(s).
7. Confirmation that nothing was pushed or deployed unless explicitly
   approved.

Phase 2 must not begin until Phase 1 passes its complete runtime acceptance
criteria.

## Tracked technical debt

- During Phase 4 topology/connection-model unification, replace
  `configJson.connectionId` ownership with an indexed `Check.connectionId`
  foreign key.
- Consider immediate first-run SSL execution as a later onboarding UX
  improvement; scheduled SSL execution remains the verified Phase 1 behavior.
- Retain wizard-modal browser flakiness as a known test-harness issue until the
  slow `/projects` loading path is stabilized.
