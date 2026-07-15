# 02 — Existing Data Model Assessment

**Phase:** 1 assessment  
**Source of truth:** `apps/api/prisma/schema.prisma` + migrations under `apps/api/prisma/migrations/`  
**Constraint:** Phase 1 does **not** add migrations. Design below is documentation for additive Phase 2+.

---

## 1. Model inventory (grouped)

### 1.1 Tenancy & access

| Model | Role |
|-------|------|
| `Organization` | Tenant root |
| `User` / `UserSession` | Operators; org membership; platform super-admin via column helper |
| `OrgApiKey` | Scoped hashed ingest/API credentials |
| `OnboardingProgress` | Org onboarding checklist |
| `AuditLog` | Generic action audit |
| `IngestReplayNonce` | Replay protection |

### 1.2 Applications / topology / checks

| Model | Role |
|-------|------|
| `Project` | Monitored application/system; secrets; health status; optional `defaultRegion` string |
| `Service` | Topology node (`ServiceType`) |
| `ServiceDependency` | Directed edges with evidence fields |
| `Check` / `CheckResult` | Agentless monitors |
| `CoverageTarget` / `MonitoringProfile` / `SyntheticJourney` | Coverage insights / synthetics |
| `ProjectIntegration` | Per-project provider configs + validation |

### 1.3 Signals & ops

| Model | Role |
|-------|------|
| `Heartbeat` / `Event` | Connected-app signals |
| `Alert` / `Incident` / `IncidentAlert` | Ops lifecycle |
| `IncidentTimelineEvent` | Incident chronology |
| `OrganizationIncidentGroup` | Cross-project correlation |
| `NotificationChannel` | Email / webhook targets |
| `MaintenanceWindow` (+ service link) | Suppression / autonomous gating |
| `ChangeEvent` | Change ledger precursor |
| `DeploymentRecord` / `OperationsTimelineEvent` | Deploy & org timeline facts |

### 1.4 Reliability & status

| Model | Role |
|-------|------|
| `SLODefinition` / `SLOWindow` | SLIs / burn |
| `StatusPage` | Public/org status |

### 1.5 Automation & remediation

| Model | Role |
|-------|------|
| `AutoRemediationPolicy` / `AutomationPolicy` | Org policy keys + modes |
| `AutomationPlaybook` (+ Version / Step) | Governance-aware playbooks |
| `AutomationRun` (+ Step / Approval / Outcome) | Planned/executed runs |
| `RemediationLog` / `RemediationLock` | Action audit + concurrency |

### 1.6 Intelligence (gated predictions)

| Model | Role |
|-------|------|
| `OperationalObservation` | Fact store |
| `LearningBaseline` / `OperationalPattern` | Evidence-only learning |
| `AiConfidenceRecord` | Confidence math |
| `PredictionCandidate` / `PredictionAccuracyLog` | Storage; product emission gated |
| `IncidentMemoryEntry` | Resolved incident memory |
| `ApplicationLearningModel` | Per-app learning state |
| `AiDecisionAudit` | AI decision trail |
| `RetentionPolicy` | Data class retention |

### 1.7 Billing / entitlements

| Model | Role |
|-------|------|
| `Plan` / `PlanEntitlement` / `Subscription` / `UsageRecord` | Org commercial gates |
| `ProjectBilling` | Per-project commercial metadata |
| `PlatformStripeSettings` / `StripeWebhookEvent` | Platform Stripe |

---

## 2. Hierarchy: today vs target

### Today

```
Organization
  └── Project (= product “Application” / System)
        └── Service (APP | MODULE | WORKFLOW | COMPONENT | legacy infra types)
```

Notes:

- UI “Application” ≈ Prisma `Project`.
- `ServiceType.APP` is a **node inside** a project, not a separate org-level System entity.
- `Project.defaultRegion` is free text — **not** a related Region row.
- No `Location`, `Branch`, `Site`, or deployment-mode enum.

### Target (Phase 2+ additive — design only here)

```
Organization
  └── Region? (optional grouping)
        └── Location (BRANCH | SITE | OFFICE | WAREHOUSE | …)
              └── System (= today’s Project, rename in product language)
                    └── Module → Workflow → Component
```

Modes: **Centralised** | **Distributed** | **Hybrid** — see [08-branch-aware-location-design.md](./08-branch-aware-location-design.md).

---

## 3. Strengths for universal ops

1. **Clear org scoping** on intelligence, automation, change events, correlation.
2. **Four-layer ServiceType** already matches Module / Workflow / Component product language.
3. **Evidence-aware dependencies** (`evidenceCount`, `evidenceStrength`, `source`) support Adaptive Operational Graph growth without inventing edges.
4. **ChangeEvent + DeploymentRecord** give a factual change spine for RCA.
5. **Prediction models exist but stay gated** — aligns with “no fake live AI”.
6. **Entitlements** already encode feature flags commercially (`topology.advanced`, `diagnosis.ai`, remediation modes).
7. **Ingest security** (HMAC + nonce) is production-shaped.

---

## 4. Structural gaps (additive migration targets)

| Gap | Impact | Mitigation direction (later phases) |
|-----|--------|-------------------------------------|
| No Location / Region entities | Cannot roll up health by branch/site | New tables; optional FKs on Project/System |
| Project is both “app” and billing/ops root | Multi-site same codebase is awkward | Location → many Systems OR System ↔ Location assignment |
| `EventType` enum mixes domain (BOOKING_FAILED) with generic ops | Industry skew | Prefer extensible `eventKey` / categories; deprecate domain enums gradually |
| Shared package `EventType` lags Prisma | Client/API drift risk | Align shared schemas in Phase 2 Connect work |
| `ProjectStatus` in shared vs Prisma mismatch | Incomplete client types | Sync enums (Prisma has MAINTENANCE/RECOVERING/UNKNOWN) |
| No OTEL signal tables | Collector path incomplete | Add span/metric/log ingest abstracts + optional raw store |
| No formal feature-flag table | Env-only for predictions | Entitlement keys + org/runtime flags later |
| Automation “System/Location” scope missing | Dangerous blast radius in multi-site | Scope runs to Location/System; default OBSERVE |

---

## 5. Migration history posture

~35+ SQL migrations from init through intelligence foundation, entitlements, Stripe, ingest replay, automation, four-layer services, etc.

**Phase 1 rule:** document only — **no new migration**.  
**Phase 2+ rule:** additive columns/tables, dual-read where renaming, never reset DB.

---

## 6. Naming guidance for future work

| Product term | Prefer for APIs/UI | Prisma today |
|--------------|-------------------|--------------|
| Application / System | System (new product) / keep “Application” UX alias | `Project` |
| Branch / Site | Location | — |
| Module / Workflow / Component | same | `Service.type` |
| Connection | Connection (UCF) | `ProjectIntegration` + ingest keys |

Keep Prisma `Project` table name initially (additive rename is costly); introduce Location without breaking Project FKs.
