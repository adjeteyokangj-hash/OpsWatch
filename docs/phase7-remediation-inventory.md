# Phase 7 — Verified remediation inventory

Date: 2026-07-19  
Baseline: `7f49aa4f9f1b0519e7466f0664683e2475b4c46e` on `main`  
Programme source: `docs/opswatch-observability-programme.md` (Phase 7)

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. This inventory locks what already exists
for remediation, automation governance, and recovery verification **before**
Phase 7 expansion.

Placeholders, seeded runs, UI labels without executors, and provider HTTP 200
responses without independent recovery evidence do **not** count as completed
capability.

**Hard stop:** Phase 7 must not begin Phase 8 security/threat work or native
Datadog/Dynatrace connectors. Do not invent repair actions where no real
connector capability exists.

---

## Existing stop points (summary)

| Exists today | Phase 7 must build / prove |
| --- | --- |
| `REMEDIATION_REGISTRY` in `actions.ts` (17 typed actions) | One authoritative universal registry used by UI/alerts/incidents/topology/workers |
| Remediator webhook path (`remediator-provider.service.ts`) with signing, idempotency, circuit, post-repair verify | `RemediationProviderAdapter` with list/validate/execute/verify/rollback |
| Automation playbooks + `AutomationRun` executor (OBSERVE / APPROVAL / AUTONOMOUS) | Full availability states; approval revalidation; autonomous only low-risk + opted-in |
| `RemediationLog` + `RemediationLock` + `RemediatorRepairAttempt` | Richer execution-run model with correlation ID + recovery states |
| Topology relationship drawer evaluates automation buttons | Evidence-based availability + progress/markers (not colour alone) |
| Alert automation evaluation service | Alert/incident panels with run/verify/rollback evidence |
| Automation workspace pages exist | Real records + filters; no fabricated runs |
| Remediator circuit + automation safeguards + maintenance windows | Action-level circuit breakers; maintenance policy options |
| Local proof script `scripts/prove-live-heal-local.ts` (worker remediator) | ≥3 distinct real remediation types + Approval + Autonomous + failed verify/rollback |

**Primary proven remediator action locally:** `restart_sync_worker` via
`WORKER_PROVIDER` (when a validated remediator webhook + secret are configured).
Other catalogue actions are wired, env/integration-gated, support-only, or
unproven at Phase 7 baseline.

---

## Path inventory

### 1. `remediation.service.ts`

| Aspect | State |
| --- | --- |
| Path | `apps/api/src/services/remediation/remediation.service.ts` |
| Role | Dispatches `RemediationAction` → typed executor; writes `RemediationLog`; approval gate via `requiresApproval`; confidence scoring; retry policy metadata; escalation audit hooks |
| Modes | Manual / approved / automatic callers; does not itself enforce OBSERVE |
| Persistence | `RemediationLog` (`status`, `executionMode`, `idempotencyKey`, policy/suppression snapshots) |
| Gap | Not the universal registry; availability states incomplete vs Phase 7 (no SETUP_REQUIRED / BLOCKED / OBSERVE_ONLY / NO_AUTOMATED_FIX as first-class); provider response can complete without shared correlation ID across timeline/audit |

### 2. `remediator-provider.service.ts`

| Aspect | State |
| --- | --- |
| Path | `apps/api/src/services/remediation/remediator-provider.service.ts` |
| Role | Project-scoped remediator webhook: gate evaluation, signed request, `RemediatorRepairAttempt` lifecycle, circuit bump, post-repair verification |
| Capabilities | Declared via `remediator-actions.ts` defaults + integration `configJson` advertised capabilities |
| Verification | `verifyPostRepairHealthy`: provider `verified`/`healthy` flags, optional wait, recent `CheckResult` PASS, or `verificationEvidence` — **HTTP 200 alone is not enough** |
| Rollback | No first-class `rollbackAction` on the remediator adapter; `ROLLBACK_DEPLOYMENT` is a separate execute path |
| Gap | Not yet a general `RemediationProviderAdapter`; verification still partly trusts provider flags; no standardised recovery state machine (`EXECUTED` → `VERIFIED_HEALTHY` / `ROLLBACK_*`) on all paths |

### 3. `automation-run-executor.service.ts`

| Aspect | State |
| --- | --- |
| Path | `apps/api/src/services/automation/automation-run-executor.service.ts` |
| Role | Playbook run lifecycle: plan → approval → execute steps via `executeRemediation`; locks; rate limits; circuit breaker; maintenance; entitlements; project autonomous mode; recovery lifecycle helpers |
| Statuses | `PLANNED`, `APPROVAL_PENDING`, `APPROVED`, `EXECUTING`, `VERIFYING`, `COMPLETED`, `FAILED`, `ROLLBACK_PENDING`, `ROLLED_BACK`, `REJECTED`, `CANCELLED`, `SUPERSEDED` |
| Gap | Parallel to remediation registry (playbook action map); must not become a second engine — Phase 7 must reuse and unify through the action registry |

### 4. Worker execution paths

| Path | Role | Notes |
| --- | --- | --- |
| `apps/worker/src/jobs/run-incident-auto-heal.job.ts` | Calls `POST /api/internal/auto-heal/run` when enabled | Off by default; tests cover skip/enable |
| `apps/worker/src/jobs/process-heartbeat-stale.job.ts` | Detects/resolves stale heartbeats | Explicitly does **not** claim remediation-caused recovery |
| Check / sync / OTEL workers | Detect failures that feed alerts/incidents | Detection only unless automation/auto-heal enabled |

### 5. Automation policies, playbooks, approvals

| Model / service | State |
| --- | --- |
| `AutomationPlaybook` / `AutomationPlaybookVersion` | Persisted playbook definitions |
| `AutomationRun` / `AutomationRunStep` / `AutomationOutcome` | Real run records (when created) |
| `AutomationApproval` | Decision + reason + scope; **missing** many Phase 7 approval fields (env, entity, relationship, expiry, risk, verification/rollback methods, evidence) |
| `AutomationPolicy` | Org policyKey + `executionMode` (default OBSERVE) |
| `auto-run-policy.service.ts` | Allowlist, cooldown, suppression, policy snapshot |
| `project-autonomous-mode.service.ts` | MONITOR_ONLY / RECOMMEND / AUTO_HEAL_SAFE / FULL_AUTONOMOUS (+ legacy OBSERVE/APPROVAL/AUTONOMOUS aliases) |
| `remediation-governance.service.ts` | Entitlement clamps (feature flag alone ≠ full autonomous) |

### 6. Observe / Approval / Autonomous modes

| Mode | Behaviour today | Gap |
| --- | --- | --- |
| OBSERVE / MONITOR_ONLY | Diagnose / recommend; execution blocked in drawer + planner paths | Must never create execution runs |
| APPROVAL / RECOMMEND | Creates approval-pending runs; HTTP approval E2E exists | Expiry + revalidate credentials/scopes before execute |
| AUTONOMOUS / AUTO_HEAL_SAFE / FULL_AUTONOMOUS | Gated by entitlement, project opt-in, allowlist, maintenance, circuit | Must enforce low-risk + pre-approved + rate limits; flag ≠ approval |

### 7. Relationship drawer automation evaluation

| Aspect | State |
| --- | --- |
| UI | `apps/web/src/components/topology/topology-relationship-drawer.tsx` |
| Eval helpers | `topology-automation-link.ts` + alert/automation evaluation services |
| Button states | `ready`, `approval_required`, `setup_required`, `observe_blocked`, `remediating`, `no_automated_fix` |
| Gap | Must resolve through universal registry; show progress/verification/rollback; relationship markers beyond line colour |

### 8. Alert automation state

| Aspect | State |
| --- | --- |
| Service | `apps/api/src/services/alert-automation-evaluation.service.ts` (+ tests) |
| UI | Alert detail pages surface remediator/automation hints |
| Gap | Full panel: policy matched, selected action, approval/run/verify evidence, exact no-action reason |

### 9. Incident remediation paths

| Aspect | State |
| --- | --- |
| Routes/controllers | `remediation.routes.ts` / `remediation.controller.ts`; automation routes; auto-heal |
| Timeline | `IncidentTimelineEvent` + Operations Timeline (`recordOperationsTimelineEvent`) |
| Gap | Recommended sequence, contributing alerts, approval/rollback history, recovery status as first-class UI |

### 10. Rollback support

| Action / path | State |
| --- | --- |
| `ROLLBACK_DEPLOYMENT` | Real remediator webhook when `DEPLOYMENT_PROVIDER` configured + validated |
| `REVIEW_HTTP_EXPECTED_STATUS` | Local check expected-status change with verify + rollback on failed verification |
| Automation `ROLLBACK_PENDING` / `ROLLED_BACK` | Statuses exist in executor |
| Gap | General `rollbackAction?` on provider adapter; prove rollback for supported actions; no destructive DB/payment rollbacks |

### 11. Recovery verification

| Path | Evidence used |
| --- | --- |
| Remediator | Provider verified flags / recent PASS check / verificationEvidence |
| HTTP expected-status review | Re-fetch after change |
| Heartbeat stale job | Consecutive healthy heartbeats (natural recovery, not remediation claim) |
| Gap | Unified recovery states (`EXECUTED`…`ROLLBACK_FAILED`); never resolve alerts solely because provider returned 200 |

### 12. Circuit breakers, rate limits, maintenance

| Mechanism | Location | State |
| --- | --- | --- |
| Remediator circuit | `remediator-config.ts` / provider service | Failure threshold + open window on integration config |
| Automation circuit / rate limits | `automation-safeguards.service.ts` | Checked in run executor |
| Remediation locks | `remediation-lock.service.ts` + `RemediationLock` | Action/incident concurrency |
| Maintenance windows | `maintenance-window-policy.service.ts` | Blocks/suppresses per service |
| Gap | Action-level breaker with admin trip/reset; maintenance options (allow low-risk / defer / emergency-only) fully productised |

### 13. Audit logs and Operations Timeline

| Channel | Examples |
| --- | --- |
| `AuditLog` | Remediation escalate, acknowledge, rotate secret, automation actions |
| Operations Timeline | Remediator statuses via `TIMELINE_EVENT.AUTOMATION_EXECUTED` |
| Incident timeline | Automation run summaries |
| Gap | Shared remediation **correlation ID** across diagnosis → approval → execute → verify → resolve |

### 14. Legacy TrueNumeris routes

| Path | Role |
| --- | --- |
| `apps/api/src/routes/truenumeris.routes.ts` | Org API-key registration of TrueNumeris-named project + portal/health services |
| UI prefills | Connection wizard TrueNumeris profile (base URL etc.) |
| Remediator comments / scripts | Historical worker remediator examples reference TrueNumeris |

**Phase 7 rule:** do not hard-code the framework around TrueNumeris. It may participate only via real scoped connector + supported safe action + verifiable recovery.

### 15. Provider connection capability declarations

| Source | Content |
| --- | --- |
| `remediator-actions.ts` | Allowlists: worker (`restart_sync_worker`, `restart_outbox_processor`, `retry_failed_jobs`, `retry_outbox_item`), service (`restart_service`), deployment (`rollback_deployment`) |
| `DEFAULT_CAPABILITIES` | Per `WORKER_PROVIDER` / `SERVICE_PROVIDER` / `DEPLOYMENT_PROVIDER` |
| Integration `configJson` | May advertise capabilities; URL/secret keys; circuit state |
| Monitoring-only integrations | Gate returns `MONITORING_ONLY` — cannot execute remediator repairs |

---

## Action catalogue (baseline)

Legend for **Real / Mock**:

- **Real** — executor performs a real OpsWatch or remediator side effect when prerequisites pass
- **Setup-required** — Real code path but blocked without connection/env/integration
- **Support** — Non-fix diagnostic/escalation
- **Risky / deferred** — Exists but Phase 7 must not expand destructive payment/customer-data behaviour

| Action key | Provider | Application | Real or mock | Required connection | Required scope | Risk (impact today) | Approval | Execution path | Verification | Rollback | Tests | Local runtime proof |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RETRY_WEBHOOKS` | OpsWatch notifications | Any with webhook channels | Real | Notification channel WEBHOOK | Org/project/alerts in context | LOW | No | `retry-webhooks.executor` → `redeliverAlertNotifications` | Delivery attempt counts only | None | Registry + executor via remediation suite | Not Phase-7-proved as distinct type at baseline |
| `RETRY_EMAILS` | OpsWatch notifications | Any with EMAIL channels | Real | EMAIL channel | Same | LOW | No | `retry-emails.executor` | Attempt counts | None | Same | Same |
| `RETRY_PAYMENT_VERIFICATION` | External HTTP | Configured apps | Setup-required / deferred | `PAYMENT_VERIFICATION_ENDPOINT` | Env + incident context | LOW (registry) — **do not expand** | No | External POST | HTTP response only | None | Unit/unsupported path | None — **exclude destructive/payment expansion** |
| `REQUEUE_FAILED_JOB` | `WORKER_PROVIDER` remediator (fallback env) | Apps with worker remediator | Real when remediator valid | Worker remediator webhook + secret | Project + capability `retry_failed_jobs` | LOW | No | Remediator repair / legacy `JOB_REQUEUE_ENDPOINT` | Remediator post-verify | None automatic | Remediator + executor tests | Partial via remediator path |
| `RERUN_HTTP_CHECK` | OpsWatch checks | Monitored services | Real | Active HTTP/KEYWORD/RESPONSE_TIME check | `serviceId` or `checkId` | LOW | No | Live fetch + `CheckResult` + alerts | Immediate check result | N/A | Executor logic | Locally runnable without remediator |
| `REVIEW_HTTP_EXPECTED_STATUS` | OpsWatch checks | Same | Real | HTTP check | incident + service + check | HIGH | Yes | Update expected status + verify | Re-run HTTP | Rollback expected status on fail | Executor | Locally runnable |
| `RERUN_SSL_CHECK` | OpsWatch checks | TLS endpoints | Real | SSL check / service URL | `serviceId` | LOW | No | TLS probe + result | Immediate | N/A | Executor | Locally runnable |
| `ACKNOWLEDGE_INCIDENT` | OpsWatch incidents | Any | Real (workflow) | Incident row | `incidentId` | LOW | No | Status → INVESTIGATING | DB state | N/A | Executor | Local |
| `ADD_INCIDENT_NOTE` | OpsWatch audit | Any | Real (workflow) | Incident | `incidentId` | LOW | No | Audit note | Audit row | N/A | Executor | Local |
| `RESTART_WORKER` | `WORKER_PROVIDER` | Remediator-connected apps | Real when configured | Validated worker remediator | Project + `restart_sync_worker` (or allowlisted) | MEDIUM | Yes | `executeRemediatorRepair` (+ legacy env fallback) | `verifyPostRepairHealthy` | None automatic | `remediator-provider.service.test.ts`, hardening E2E, `prove-live-heal-local.ts` | **Primary local proof** when webhook available |
| `RESTART_SERVICE` | `SERVICE_PROVIDER` | Same pattern | Setup-required | Service remediator | `serviceId` + capability | MEDIUM | Yes | Remediator | Post-repair verify | None | Remediator mapping tests | Unproven unless connector present |
| `ROLLBACK_DEPLOYMENT` | `DEPLOYMENT_PROVIDER` | Same | Setup-required | Deployment remediator | Project + capability | HIGH | Yes | Remediator | Post-repair verify | Action *is* rollback | Mapping tests | Unproven unless connector present |
| `DISABLE_INTEGRATION` | OpsWatch notification channels | Project channels | Real (channel disable) | Channel / project | `integrationId` or resolvable channel | MEDIUM | Yes | Deactivate channel | Channel `isActive` | Manual re-enable | Executor | Local for notification channels only — not generic connector re-enable |
| `ROTATE_WEBHOOK_SECRET` | OpsWatch project secret | Project | Real | Project | `projectId` | MEDIUM | Yes | Rotate `signingSecret` (legacy field still present) | Secret changed (not returned) | No auto old-secret restore | Executor | Local; Phase 2 managed credentials still coexist |
| `CHECK_PROVIDER_STATUS` | STATUS_PROVIDER / env | Configured | Support / setup-required | `PROVIDER_STATUS_URL` | — | LOW | Manual only | GET status URL | Response body | N/A | Unsupported without env | — |
| `OPEN_RUNBOOK` | RUNBOOK_PROVIDER / env | Configured | Support | `RUNBOOK_BASE_URL` | — | LOW | Manual only | Build URL | None | N/A | — | — |
| `REQUEST_HUMAN_REVIEW` | OpsWatch incidents | Any | Support / workflow | Incident | `incidentId` | LOW | Manual only | Audit + status | Audit | N/A | — | — |

### Remediator webhook actions (provider allowlist)

| Remediator action | Provider type | Mapped registry action(s) | Real | Notes |
| --- | --- | --- | --- | --- |
| `restart_sync_worker` | WORKER_PROVIDER | `RESTART_WORKER` | Real | Primary verified path |
| `restart_outbox_processor` | WORKER_PROVIDER | Via `extra.remediatorAction` | Real if advertised | Capability-gated |
| `retry_failed_jobs` | WORKER_PROVIDER | `REQUEUE_FAILED_JOB` | Real if advertised | |
| `retry_outbox_item` | WORKER_PROVIDER | Via extra | Real if advertised | |
| `restart_service` | SERVICE_PROVIDER | `RESTART_SERVICE` | Real if connector | |
| `rollback_deployment` | DEPLOYMENT_PROVIDER | `ROLLBACK_DEPLOYMENT` | Real if connector | High risk |

---

## Persistence models (reuse candidates)

| Model | Use in Phase 7 |
| --- | --- |
| `RemediationLog` | Keep; extend via additive fields or linked run if needed |
| `RemediationLock` | Keep for concurrency |
| `RemediatorRepairAttempt` | Keep for remediator attempts |
| `AutomationRun` (+ steps, approvals, outcomes) | Reuse — do **not** duplicate automation engines |
| `AutomationPolicy` / playbooks | Reuse governance |
| Additive candidates (brief) | Capability/approval/execution/verification/rollback/circuit/evidence link tables **only if** existing models cannot hold required fields |

---

## Tests present at baseline

| Area | Files (representative) |
| --- | --- |
| Remediator | `remediator-provider.service.test.ts`, `remediator-config.test.ts` |
| Hardening / DB E2E | `remediation-hardening.database-e2e.test.ts` |
| Automation | `automation-phase3.test.ts`, `automation-planner.service.test.ts`, `automation-http-approval.database-e2e.test.ts`, `automation-redis-playbook.database-e2e.test.ts` |
| Governance | `remediation-governance.service.test.ts`, `project-autonomous-mode.service.test.ts` |
| Alerts / topology | `alert-automation-evaluation.service.test.ts`, `topology-automation-link.test.ts` |
| Worker | `run-incident-auto-heal.job.test.ts` |
| Controlled automation | `controlled-automation.service.test.ts` |

---

## Local runtime proof at baseline

| Proof | Evidence |
| --- | --- |
| Worker remediator heal | `scripts/prove-live-heal-local.ts` (optional TrueNumeris/local remediator paths) — **not** claimed as multi-type Phase 7 complete |
| HTTP/SSL rerun | Executable against local checks without remediator |
| Automation approval HTTP E2E | Database E2E when `RUN_DATABASE_E2E=true` |

Phase 7 still requires: ≥3 distinct **real** remediation types; ≥1 Approval; ≥1 Autonomous low-risk; ≥1 failed verification or rollback; artefacts under `test-artifacts/phase7-remediation/`.

---

## Gaps Phase 7 must close

1. Universal action registry as single authority for UI and workers.  
2. `RemediationProviderAdapter` for all remediation providers.  
3. Availability states: READY / APPROVAL_REQUIRED / SETUP_REQUIRED / BLOCKED / NO_AUTOMATED_FIX / OBSERVE_ONLY with exact reasons.  
4. Approval records with full field set + expiry + prerequisite revalidation.  
5. Execution reliability: timeout, cancel, dead-letter, stale RUNNING recovery, action locks (extend existing).  
6. Evidence-based recovery states; alert/incident resolution only after verified recovery.  
7. Topology markers + alert/incident/Automation workspace panels on **real** records.  
8. Shared correlation ID across timeline + audit.  
9. Action circuit breakers + maintenance policy options.  
10. Credential/connection pre-checks; decrypt only in trusted path; no secrets in evidence.  
11. Prove three remediation types + governance modes + failed verify/rollback.  
12. Comprehensive tests (brief §24) and verification gates (§25) with honest acceptance (§26).

---

## Explicit non-goals (this inventory)

- Phase 8 security-event / containment product work  
- Native Datadog or Dynatrace connectors  
- Destructive database, payment, or customer-data repair actions  
- Claiming provider HTTP success as remediation success  
- Hard-coding the platform to TrueNumeris  

---

## Commit

Inventory-only commit (implementation follows in subsequent Phase 7 commits):

`docs: inventory verified remediation capabilities`
