# OpsWatch AI Brain — Technical Specification

**Document type:** Governance and architecture specification  
**Status:** Under review — **no implementation authorised**  
**Version:** 0.1 (draft for review)  
**Date:** 2026-07-11  
**Prerequisite:** Production gate FULL PASS and rollout sign-off  
**Sequence:** Rollout sign-off → this specification → review and approval → implementation planning → phased delivery

---

## Document legend

Every section in this specification uses the following labels so reviewers can distinguish proposal from reality:

| Label | Meaning |
|-------|---------|
| **CURRENT** | Capability that exists in the OpsWatch codebase today |
| **PROPOSED** | Contract, interface, or behaviour defined here for future implementation — not yet shipped |
| **FUTURE** | Planned phase beyond the first implementation slice — depends on prior approval |
| **OUT OF SCOPE** | Explicitly excluded from the AI Brain remit |
| **APPROVAL REQUIRED** | Gate that must pass before the associated work may begin |

---

## Central rule (non-negotiable)

> **The AI Brain may recommend, plan, and act only within approved policy boundaries. Human-defined policy, permissions, maintenance controls, and approval requirements always take precedence over model output.**

This rule applies at every stage of the decision flow. Model confidence, LLM suggestions, and autonomous eligibility scores are **inputs** to governance — never overrides.

**Implications:**

- If model output conflicts with RBAC, maintenance window policy, automation mode, or approval gates → **policy wins; model output is discarded or downgraded to advisory text only**.
- If confidence is below configured thresholds → **no autonomous action**; human review is mandatory.
- If a playbook step is marked `approvalRequired` → **execution waits for explicit operator approval**, regardless of planner recommendation.
- If `AutomationPolicy.executionMode` is `OBSERVE` → **plans may be recorded; no execution occurs**.
- Audit records must show both model recommendation and policy decision when they differ.

**APPROVAL REQUIRED:** This central rule must be accepted unchanged before any AI Brain implementation slice is authorised.

---

## 1. Objectives and scope

### 1.1 Purpose **PROPOSED**

The AI Brain is OpsWatch's **platform intelligence layer** — a governed decision system that helps OkangGroup applications and operators move from raw monitoring signals to safe, auditable operational action.

It serves multiple OkangGroup applications through a shared platform contract. It is not a standalone product surface; it is the orchestration, reasoning, and learning substrate behind incident diagnosis, automation planning, and progressively autonomous remediation.

### 1.2 Objectives **PROPOSED**

| Objective | Description |
|-----------|-------------|
| **Accelerate diagnosis** | Combine rules, topology, correlation, and optional LLM reasoning to produce evidence-backed incident narratives |
| **Enable safe automation** | Plan multi-step remediation playbooks with explicit approval and observe modes |
| **Preserve operator control** | Every autonomous path is policy-gated, reversible, and auditable |
| **Learn from outcomes** | Capture execution results to improve future recommendations without bypassing governance |
| **Scale across applications** | Provide a provider-abstract, extensible contract reusable by Noble Express, OpsWatch itself, and future OkangGroup apps |

### 1.3 In scope **PROPOSED**

- Incident diagnosis and evidence assembly
- Automation plan generation and lifecycle management
- Policy-aware action recommendation and eligibility scoring
- Approval workflow integration
- Outcome capture and evaluation feedback loops
- Cross-layer dependency and topology reasoning
- Operator-facing advisory surfaces (recommendations, plans, confidence, evidence)

### 1.4 Out of scope **OUT OF SCOPE**

| Exclusion | Rationale |
|-----------|-----------|
| **Security Command Centre scoring** | Separate Phase 2 workstream; not part of AI Brain v1 |
| **Unsupervised self-modification of production config** | Model output must never directly mutate check definitions, billing, RBAC, or org structure without approval executors |
| **Bypass of maintenance windows** | Maintenance policy is absolute |
| **Cross-tenant data access** | All brain operations are organisation-scoped |
| **Replacement of human on-call accountability** | AI Brain assists; operators retain authority |
| **Direct LLM-to-production side effects** | LLM output is always mediated by typed executors and policy checks |
| **Navigation or UI restructuring** | Phase 1 navigation remains frozen unless separately approved |

### 1.5 Current platform baseline **CURRENT**

OpsWatch already ships substantial building blocks that the AI Brain will unify — not replace:

| Area | Current state | Primary locations |
|------|---------------|-------------------|
| Rule-based incident diagnosis | Functional | `apps/api/src/services/ai/incident-ai.service.ts` |
| Deep analysis (rules + correlation + optional LLM) | Functional; LLM off by default | `apps/api/src/services/ai/incident-analysis.service.ts` |
| Remediation suggest + auto-run eligibility | Functional | `apps/api/src/services/remediation/remediation-suggest.service.ts` |
| Versioned playbook governance | Functional | `apps/api/src/services/automation/playbook-governance.service.ts` |
| Automation planner + run executor | Functional | `apps/api/src/services/automation/automation-planner.service.ts` |
| Auto-heal sweep | Functional; worker off by default | `apps/api/src/services/remediation/auto-heal.service.ts` |
| RBAC permission matrix | Functional | `apps/api/src/auth/permissions.ts` |
| Maintenance autonomous gating | Functional | `apps/api/src/services/maintenance-window-policy.service.ts` |
| Four-layer dependency impact | Functional | `apps/api/src/services/dependency-impact.service.ts` |

**Gap:** There is no unified "AI Brain" service, API namespace, UI product surface, persistent memory store, or cross-incident learning loop. LLM paths are opt-in overlays. `Project.automationMode` is stored in UI but **not enforced** by the automation backend (real control is `AutomationPolicy.executionMode` in the database).

---

## 2. System architecture

### 2.1 Architectural principles **PROPOSED**

1. **Policy-first orchestration** — every brain operation passes through a policy engine before side effects
2. **Typed actions only** — no free-form shell commands; all execution via registered remediation executors
3. **Evidence before action** — diagnosis must cite alerts, timeline events, topology, and check results
4. **Mode-aware behaviour** — Observe, Approval, and Autonomous modes change what is permitted, not what is recommended
5. **Provider abstraction** — LLM and future model providers are swappable behind a stable interface
6. **Platform, not app-specific** — brain contracts are org/project scoped; application context is a parameter

### 2.2 Logical components **PROPOSED**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Operator / API consumers                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                     AI Brain orchestration layer                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Observer │ │ Diagnost │ │ Planner  │ │ Approver │ │Verifier │ │
│  │          │→│          │→│          │→│  gate    │→│         │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│         │            │            │            │            │      │
│         └────────────┴────────────┴────────────┴────────────┘      │
│                              │                                       │
│                    ┌─────────▼─────────┐                            │
│                    │   Policy engine   │ ← RBAC, maintenance,       │
│                    │                   │   automation mode,          │
│                    │                   │   confidence thresholds     │
│                    └─────────┬─────────┘                            │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼──────┐    ┌──────────▼─────────┐   ┌───────▼───────┐
│   Memory /   │    │  Reasoning pipeline │   │  Executor     │
│   outcome    │    │  (rules, graph,     │   │  registry     │
│   store      │    │   optional LLM)     │   │  (remediation)│
└──────────────┘    └────────────────────┘   └───────────────┘
```

| Component | Responsibility | Current analogue |
|-----------|----------------|----------------|
| **Observer** | Ingest alerts, incidents, heartbeats, events, topology | Monitoring ingestion, correlation jobs |
| **Diagnostician** | Produce evidence-backed diagnosis with confidence | `incident-analysis.service.ts`, `incident-ai.service.ts` |
| **Planner** | Select playbook, create automation run steps | `automation-planner.service.ts` |
| **Policy engine** | Enforce RBAC, maintenance, mode, cooldowns, circuits | `auto-run-policy.service.ts`, `automation-safeguards.service.ts` |
| **Approver gate** | Human approval with reason and version immutability checks | `approveAutomationRun()`, playbook governance |
| **Executor registry** | Typed remediation actions with tiers | `remediation/actions.ts`, executors directory |
| **Verifier** | Post-action check, rollback trigger | Playbook verify steps, executor rollback paths |
| **Memory / outcome store** | Persist decisions, outcomes, feedback | **Not yet implemented** (partial: `RemediationLog`, `AutomationRun`) |

### 2.3 Deployment topology **CURRENT + PROPOSED**

| Service | Current role | AI Brain role **PROPOSED** |
|---------|--------------|---------------------------|
| **API** | Diagnosis, planning, approval, executor dispatch | Host brain orchestration API; policy enforcement boundary |
| **Worker** | Scheduled checks, correlation, auto-heal sweep, autonomous run sweep | Brain execution worker; heartbeat and scheduler health |
| **Web** | Incident UI, automation plan panel, playbook governance | Brain advisory surfaces (no autonomous UI actions without permission) |
| **PostgreSQL** | All operational state | Brain memory, audit, outcome tables **PROPOSED** |
| **External LLM** | Optional overlay via OpenAI | Provider abstraction; off by default **CURRENT** |

### 2.4 API namespace **PROPOSED**

**PROPOSED** future namespace: `/api/brain/*` (not implemented).

Until implementation is approved, existing routes remain authoritative:

| Concern | Current route |
|---------|---------------|
| Diagnosis suggest | `POST /api/remediation/suggest` |
| Auto-run | `POST /api/remediation/auto-run` |
| Automation plan | `POST /api/automation/plan` |
| Run approval | `POST /api/automation/runs/:id/approve` |
| Playbook governance | `/api/automation/playbooks/*` |

**APPROVAL REQUIRED:** Namespace design and migration plan must be approved before `/api/brain/*` is introduced.

---

## 3. Data model

### 3.1 Existing entities **CURRENT**

| Entity | Role in brain context |
|--------|----------------------|
| `Incident` | Primary unit of diagnosis and automation planning |
| `Alert` | Signal input; linked to services and checks |
| `Service` / four-layer types | Topology nodes (APP, MODULE, WORKFLOW, COMPONENT) |
| `Check` / `CheckResult` | Health evidence |
| `AutomationRun` / `AutomationRunStep` | Plan lifecycle and execution state |
| `AutomationPlaybook` / `AutomationPlaybookVersion` | Versioned, governable action sequences |
| `AutomationPolicy` | Global observe/approval/autonomous mode |
| `AutoRemediationPolicy` | Per-scope auto-heal enablement |
| `RemediationLog` | Action execution audit |
| `MaintenanceWindow` | Autonomous suppression |
| `AuditLog` | Operator actions |

### 3.2 Proposed brain entities **PROPOSED**

These entities define the **contract** for future implementation. They do not exist as first-class tables today.

#### `BrainDecision`

Records every brain recommendation regardless of whether it was acted upon.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organizationId` | UUID | Tenant scope |
| `projectId` | UUID | Application scope |
| `incidentId` | UUID? | Linked incident if applicable |
| `stage` | enum | `OBSERVE`, `DIAGNOSE`, `PLAN`, `APPROVE`, `EXECUTE`, `VERIFY`, `LEARN` |
| `mode` | enum | `RULES`, `CORRELATION`, `LLM`, `HYBRID` |
| `confidence` | decimal 0–1 | Model/rule confidence |
| `policyOutcome` | enum | `ALLOWED`, `BLOCKED`, `DOWNGRADED`, `APPROVAL_REQUIRED` |
| `policyReason` | text | Why policy overrode or gated model output |
| `inputHash` | string | Fingerprint of evidence snapshot |
| `outputJson` | JSON | Structured recommendation (redacted) |
| `createdAt` | timestamp | Immutable creation time |

#### `BrainOutcome`

Links decisions to execution results for learning.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `decisionId` | UUID | FK → `BrainDecision` |
| `automationRunId` | UUID? | FK if plan executed |
| `remediationLogId` | UUID? | FK if single action executed |
| `result` | enum | `SUCCESS`, `PARTIAL`, `FAILED`, `ROLLED_BACK`, `SUPERSEDED` |
| `operatorFeedback` | enum? | `HELPFUL`, `NEUTRAL`, `MISLEADING` |
| `feedbackNote` | text? | Operator annotation |
| `verifiedAt` | timestamp? | Post-action verification time |

#### `BrainMemoryEntry` **FUTURE**

Cross-incident contextual memory (embeddings or structured facts). Requires separate privacy and retention review before implementation.

### 3.3 Lifecycle and versioning **PROPOSED**

- **Brain decisions are append-only.** Corrections create new decision records referencing prior IDs.
- **Playbook versions remain immutable** once approved; brain plans reference a specific version ID.
- **Audit retention:** minimum 90 days online; align with org compliance requirements.
- **PII and secret redaction:** all stored brain output passes through `redact-secrets.ts` equivalent before persistence.

### 3.4 Current vs proposed gap **CURRENT**

Today, audit evidence is distributed across `RemediationLog`, `AutomationRun`, `AuditLog`, and incident timeline events. There is no unified `BrainDecision` record linking model recommendation to policy outcome.

---

## 4. Decision flow

### 4.1 Canonical pipeline **PROPOSED**

```
Observe → Diagnose → Plan → Approve → Execute → Verify → Learn
```

Each stage has defined inputs, outputs, policy checkpoints, and failure modes.

### 4.2 Stage definitions

| Stage | Input | Output | Policy checkpoint | Current implementation |
|-------|-------|--------|-------------------|------------------------|
| **Observe** | Alerts, heartbeats, events, check results | Normalised signal bundle | Maintenance suppression | **CURRENT** — ingestion + correlation jobs |
| **Diagnose** | Signal bundle + incident context | Diagnosis, confidence, suggested actions, evidence | `diagnosis:read`; LLM env gates | **CURRENT** — `buildIncidentDiagnosis()` |
| **Plan** | Diagnosis + playbook catalog | `AutomationRun` with steps | `automation:plan:*`; rate limits | **CURRENT** — `planAutomationForIncident()` |
| **Approve** | Pending run | Approved/rejected run with reason | `automation:plan:approve`; playbook version check | **CURRENT** — approval endpoints |
| **Execute** | Approved run or autonomous-eligible run | Step results, remediation logs | RBAC tier, maintenance, circuits, cooldowns | **CURRENT** — executor registry |
| **Verify** | Execution result | Pass/fail, rollback decision | Verify steps in playbook | **CURRENT** — playbook verify steps |
| **Learn** | Outcome + operator feedback | Updated scoring weights, outcome record | No auto model retrain without review | **FUTURE** — partial logs exist today |

### 4.3 Mode interaction **CURRENT + PROPOSED**

| `AutomationPolicy.executionMode` | Diagnose | Plan | Execute |
|----------------------------------|----------|------|---------|
| **OBSERVE** | Yes | Yes (record only) | **No** |
| **APPROVAL** | Yes | Yes | Only after operator approval |
| **AUTONOMOUS** | Yes | Yes | Only if playbook is fully low-risk + all policy checks pass |

**CURRENT:** Mode is stored in `AutomationPolicy` (database). Default seed: `OBSERVE`, `enabled: false`.

**PROPOSED:** Operator-facing API and UI to manage automation policy per org (today DB-only).

### 4.4 Confidence thresholds **CURRENT**

| Threshold | Value | Effect |
|-----------|-------|--------|
| Correlation upgrade | ≥ 0.55 (candidate score) | Upgrades analysis mode to CORRELATION |
| Diagnosis auto-run floor | ≥ 0.55 | Required for `autoRunEligible` |
| Action auto-run floor | ≥ 70 (`AUTO_RUN_MIN_CONFIDENCE_SCORE`) | Required for automatic safe action |
| Unknown diagnosis | 0.30 | No suggested actions |

**PROPOSED:** Centralise thresholds in a policy-configurable `BrainPolicyConfig` rather than scattered env vars.

---

## 5. Safety and governance

### 5.1 RBAC **CURRENT**

Permission matrix (abbreviated):

| Permission | Minimum role | Brain stage |
|------------|--------------|-------------|
| `diagnosis:read` | VIEWER | Diagnose (read) |
| `remediation:execute:safe` | INCIDENT_RESPONDER | Execute safe actions |
| `remediation:execute:approval` | AUTOMATION_OPERATOR | Execute approval-tier actions |
| `remediation:auto_heal` | AUTOMATION_OPERATOR | Trigger auto-heal sweep |
| `remediation:approve` | AUTOMATION_OPERATOR | Approve gated actions |
| `automation:plan:observe` | VIEWER | Plan in observe mode |
| `automation:plan:approve` | AUTOMATION_OPERATOR | Approve automation runs |
| `automation:execute` | AUTOMATION_OPERATOR | Execute runs |
| `policy:manage` | ADMIN | Configure policies |
| `playbooks:manage` | ADMIN | Draft/submit playbooks |
| `maintenance:manage` | AUTOMATION_OPERATOR | Maintenance windows |

**PROPOSED:** Add `brain:configure` (ADMIN) for LLM provider and threshold management when brain UI is implemented.

### 5.2 Action tiers **CURRENT**

| Tier | Examples | Execution rule |
|------|----------|----------------|
| **SAFE_AUTOMATIC** | Rerun check, retry webhooks, acknowledge, add note | May auto-execute if policy + confidence allow |
| **APPROVAL_REQUIRED** | Restart service, rollback deploy, review HTTP status | Requires explicit operator approval |
| **MANUAL_ONLY** | Open runbook, request human review | Advisory only; no autonomous execution |

### 5.3 Safeguards **CURRENT**

| Safeguard | Mechanism |
|-----------|-----------|
| Circuit breakers | Per-action failure caps (`CIRCUIT_*` env) |
| Rate limits | Plans/org/hour, runs/playbook/hour, remediations/incident/hour |
| Cooldowns | Per-action minimum intervals |
| Suppression guard | >25% failure rate over last 20 runs blocks auto-run |
| Maintenance block | `allowAutonomous: false` blocks auto-heal and autonomous runs |
| Per-incident lock | Prevents concurrent remediation (`REMEDIATION_LOCK_TTL_MS`) |
| Playbook version immutability | Approval invalidated if version changes |
| Platform playbook approver allowlist | `PLATFORM_PLAYBOOK_APPROVER_EMAILS` |

### 5.4 LLM governance **CURRENT + PROPOSED**

**CURRENT:**

- LLM is **off by default** (`INCIDENT_AI_LLM_ENABLED=false`, `AUTOMATION_LLM_PLANNER_ENABLED=false`)
- Requires `OPENAI_API_KEY` when enabled
- Prompt input is redacted; output is JSON-schema constrained
- LLM failure silently falls back to rules/correlation draft
- LLM output never bypasses executor or approval gates

**PROPOSED:**

- Provider registry supporting multiple backends (OpenAI, Azure OpenAI, local model)
- Per-org LLM enablement flag (not just env var)
- Token budget and cost caps
- Model version pinning with change approval
- Mandatory disclosure in UI when LLM contributed to a recommendation

### 5.5 Rollback **CURRENT**

- Playbook steps may include verify-and-rollback paths
- `REVIEW_HTTP_EXPECTED_STATUS` executor stores prior config and rolls back on verification failure
- Automation run statuses include `ROLLBACK_PENDING` and `ROLLED_BACK`

---

## 6. Integrations

### 6.1 Monitoring and incidents **CURRENT**

| Integration | Direction | Purpose |
|-------------|-----------|---------|
| Alerts / incidents | Inbound | Diagnosis input |
| Four-layer service graph | Inbound | Root cause and propagation analysis |
| Heartbeats | Inbound | Staleness and worker health signals |
| SLO burn rate | Inbound | Reliability context |
| Check execution | Bidirectional | Rerun and verify |
| Incident timeline | Outbound | Record brain decisions and actions |
| Notifications (email/webhook) | Outbound | Alert operators on approval requests and outcomes |

### 6.2 Automation and remediation **CURRENT**

| Integration | Purpose |
|-------------|---------|
| Playbook catalog | Governed action sequences |
| Automation runs | Multi-step plan lifecycle |
| Remediation executors | Typed side effects |
| Auto-heal worker job | Periodic safe-action sweep |
| Autonomous run worker job | Periodic autonomous plan execution |

### 6.3 CMDB / topology **CURRENT + PROPOSED**

**CURRENT:** Service dependency graph within OpsWatch (`ServiceDependency`, four-layer types).

**PROPOSED:** External CMDB sync adapter for OkangGroup shared topology (read-only in v1; no write-back without approval).

### 6.4 External providers **CURRENT**

| Provider | Usage | Default |
|----------|-------|---------|
| OpenAI | Diagnosis enhancement, playbook selection | Disabled |
| SMTP | Alert delivery | Optional |
| Webhooks | Restart, rollback, remediation | Optional |

### 6.5 Multi-application support **PROPOSED**

Each OkangGroup application is an OpsWatch **project** with:

- Isolated monitoring graph
- Project-scoped automation policy override (future)
- Shared org-level playbook catalog with approval governance
- Brain decisions scoped by `organizationId` + `projectId`

Applications never share brain memory across org boundaries.

---

## 7. Learning strategy

### 7.1 Principles **PROPOSED**

1. **Learn from outcomes, not from unsupervised model drift**
2. **Operator feedback is first-class data**
3. **No automatic production policy changes based on learning alone**
4. **Evaluation before any model or weight update**

### 7.2 Outcome capture **CURRENT + PROPOSED**

**CURRENT:**

- `RemediationLog` records action success/failure
- `AutomationRun` / step statuses record plan outcomes
- Accuracy dashboard (`/accuracy`) tracks auto-run metrics

**PROPOSED (`BrainOutcome`):**

- Link every diagnosis and plan to eventual result
- Capture operator feedback (`HELPFUL` / `MISLEADING`)
- Feed aggregated metrics into confidence calibration reviews

### 7.3 Feedback loops **PROPOSED**

| Loop | Frequency | Human gate |
|------|-----------|------------|
| Action success rate → suppression guard | Real-time | Automatic (existing) |
| Diagnosis accuracy review | Weekly | Operator / ADMIN review |
| Playbook effectiveness ranking | Monthly | ADMIN approval to change playbook priority |
| LLM prompt/model update | On demand | **APPROVAL REQUIRED** — change control |
| Cross-incident memory | **FUTURE** | Privacy review + ADMIN enablement |

### 7.4 Safeguards against harmful learning **PROPOSED**

- Learning outputs may adjust **ranking and confidence calibration** only — not RBAC, not approval bypass, not maintenance policy
- Regression test suite required before any model or prompt change is promoted
- Shadow mode: new model runs in parallel, outputs compared, no execution authority

---

## 8. Extensibility

### 8.1 Provider abstraction **PROPOSED**

```
BrainReasoningProvider (interface)
├── RulesProvider          (CURRENT — incident-ai.service.ts)
├── CorrelationProvider    (CURRENT — dependency-impact.service.ts)
├── LlmProvider            (CURRENT — OpenAI overlay)
└── [Future] LocalModelProvider
```

All providers return a normalised `BrainRecommendation` DTO. The policy engine consumes the DTO — not raw provider output.

### 8.2 Executor plugin model **CURRENT + PROPOSED**

**CURRENT:** Remediation actions registered in `actions.ts` with executor modules.

**PROPOSED:** Documented executor registration contract:

| Requirement | Description |
|-------------|-------------|
| `actionKey` | Unique identifier |
| `policyTier` | SAFE_AUTOMATIC / APPROVAL_REQUIRED / MANUAL_ONLY |
| `execute(context)` | Typed execution with rollback support |
| `validate(context)` | Pre-flight context validation |
| `describe()` | Human-readable description for audit |

New executors require code review + playbook governance approval before appearing in autonomous allowlists.

### 8.3 Application adapter **PROPOSED**

OkangGroup applications integrate via:

1. OpsWatch project provisioning
2. Four-layer service graph definition
3. Playbook selection (seed or custom)
4. Automation policy configuration
5. Optional LLM enablement per org

No application-specific code paths inside the brain core.

---

## 9. Non-functional requirements

### 9.1 Performance **PROPOSED**

| Operation | Target |
|-----------|--------|
| Rule-based diagnosis | < 2 s p95 |
| Correlation analysis | < 5 s p95 |
| LLM-enhanced diagnosis | < 30 s p95 (with timeout fallback) |
| Plan generation | < 3 s p95 |
| Policy evaluation | < 200 ms p95 |

### 9.2 Availability and resilience **PROPOSED**

- Brain diagnosis and planning degrade gracefully if LLM provider is unavailable (**CURRENT** — fallback implemented)
- Worker execution is idempotent with locks and idempotency keys (**CURRENT**)
- No single brain failure may block core monitoring ingestion

### 9.3 Observability **CURRENT + PROPOSED**

**CURRENT:** Structured logs, remediation logs, automation run statuses, self-monitoring gate.

**PROPOSED:**

- `BrainDecision` audit trail
- Metrics: diagnosis latency, plan approval rate, autonomous success rate, policy block rate
- Trace correlation ID from alert → diagnosis → plan → execution

### 9.4 Security **CURRENT + PROPOSED**

**CURRENT:**

- Org-scoped queries on all mutations
- Secret redaction in LLM prompts
- Worker internal routes require `WORKER_INTERNAL_SECRET`
- RBAC on all brain-adjacent endpoints

**PROPOSED:**

- Brain API rate limiting per org
- Output content filtering for LLM responses
- Encryption at rest for `BrainMemoryEntry` (future)

---

## 10. Implementation roadmap

### 10.1 Phase 0 — Specification and approval **CURRENT STATUS**

| Item | Status |
|------|--------|
| Production gate FULL PASS | **COMPLETE** |
| AI Brain technical specification | **THIS DOCUMENT — under review** |
| Rollout sign-off | Pending |
| Specification approval | Pending |

**No implementation authorised during Phase 0.**

### 10.2 Phase 1 — Unified brain contracts (first slice) **FUTURE**

**APPROVAL REQUIRED before start.**

| Deliverable | Type |
|-------------|------|
| `BrainDecision` persistence and audit API | PROPOSED |
| Unified `/api/brain/diagnose` wrapping existing diagnosis pipeline | PROPOSED |
| Policy outcome recorded on every recommendation | PROPOSED |
| Brain advisory panel on incident page (read-only) | PROPOSED |
| Wire `Project.automationMode` OR deprecate in favour of documented `AutomationPolicy` API | PROPOSED |

**Explicitly not in Phase 1:** LLM provider registry UI, cross-incident memory, Security Command Centre, navigation changes.

### 10.3 Phase 2 — Operator policy UI and approval refinement **FUTURE**

| Deliverable | Type |
|-------------|------|
| Automation policy management API + UI | PROPOSED |
| Centralised threshold configuration | PROPOSED |
| Enhanced approval workflow with brain decision context | PROPOSED |
| Outcome feedback capture (`BrainOutcome`) | PROPOSED |

### 10.4 Phase 3 — Governed learning loop **FUTURE**

| Deliverable | Type |
|-------------|------|
| Outcome aggregation and accuracy reporting | PROPOSED |
| Confidence calibration review tooling | PROPOSED |
| Shadow-mode LLM evaluation | PROPOSED |

### 10.5 Phase 4 — Cross-application brain platform **FUTURE**

| Deliverable | Type |
|-------------|------|
| Multi-app playbook catalog sharing with org governance | PROPOSED |
| External CMDB read adapter | PROPOSED |
| Optional cross-incident memory (privacy-reviewed) | PROPOSED |

### 10.6 Autonomy progression **PROPOSED**

Autonomy increases only through explicit policy changes — never through model self-elevation:

```
OBSERVE (default) → APPROVAL → AUTONOMOUS (low-risk playbooks only)
```

Each transition requires ADMIN `policy:manage` action, documented reason, and passing accuracy metrics from prior phase.

---

## 11. Approval prerequisites

The following must be satisfied before **any** AI Brain implementation slice begins:

| # | Prerequisite | Status |
|---|--------------|--------|
| 1 | Production gate FULL PASS | **Met** |
| 2 | Controlled rollout sign-off recorded | Pending |
| 3 | This specification reviewed by platform / on-call stakeholders | Pending |
| 4 | Central rule (Section "Central rule") accepted without modification | Pending |
| 5 | Phase scope for first slice explicitly approved (Section 10.2) | Pending |
| 6 | No concurrent Phase 2+ UI work (Security Command Centre, nav changes) | **Met** (not started) |
| 7 | LLM enablement decision documented (on/off for target environment) | Pending |

**Implementation planning** may begin only after items 2–5 are marked approved in a signed revision of this document.

---

## 12. Document control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1 | 2026-07-11 | OpsWatch platform | Initial draft for review |

**Reviewers:** Platform administrator, on-call lead, OkangGroup application owner.

**Next action:** Review and approve this specification. Do not begin AI Brain implementation until approval is recorded.

---

## Appendix A — Environment variables (brain-relevant)

Variables below affect brain-adjacent behaviour **today**. A future `BrainPolicyConfig` may supersede scattered env configuration.

| Variable | Service | Default | Effect |
|----------|---------|---------|--------|
| `INCIDENT_AI_LLM_ENABLED` | API | `false` | LLM diagnosis overlay |
| `INCIDENT_AI_LLM_MODEL` | API | `gpt-4o-mini` | Model selection |
| `OPENAI_API_KEY` | API | empty | LLM auth |
| `AUTOMATION_LLM_PLANNER_ENABLED` | API | `false` | LLM playbook selection |
| `AUTO_RUN_MIN_CONFIDENCE_SCORE` | API | `70` | Action auto-run threshold |
| `AUTO_REMEDIATION_ENABLED` | API | enabled | Master auto-heal switch |
| `AUTO_HEAL_DEFAULT_ENABLED` | API | varies | Bootstrap GLOBAL auto-heal policy |
| `WORKER_AUTO_HEAL_ENABLED` | Worker | `false` | Periodic auto-heal sweep |
| `WORKER_AUTOMATION_AUTONOMOUS_ENABLED` | Worker | `false` | Periodic autonomous run sweep |
| `PLATFORM_PLAYBOOK_APPROVER_EMAILS` | API | empty | Global playbook approvers |
| `CIRCUIT_*` | API | varies | Circuit breaker thresholds |
| `AUTOMATION_RATE_*` | API | varies | Rate limits |

## Appendix B — Related documents

| Document | Relationship |
|----------|--------------|
| [production-gate-report.md](./production-gate-report.md) | Prerequisite evidence; FULL PASS |
| [close-out-gate.md](./close-out-gate.md) | Gate checklist |
| [db-recovery-runbook.md](./db-recovery-runbook.md) | Rollback procedures for autonomous actions |
| [deployment-runbook.md](./deployment-runbook.md) | Production deployment |
