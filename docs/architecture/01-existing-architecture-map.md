# 01 — Existing Architecture Map

**Phase:** 1 assessment  
**Status:** CURRENT (as of 2026-07-15)  
**Code roots:** `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/opswatch-client`

---

## 1. Runtime components

| Component | Stack | Role |
|-----------|-------|------|
| **web** | Next.js App Router | Operator dashboard (light theme); Applications/Projects, Topology, Incidents, Alerts, Intelligence, Connect, Automation, Billing |
| **api** | Express + Prisma + PostgreSQL | Auth sessions, signed ingest, domain APIs, intelligence snapshot, automation planning |
| **worker** | Node scheduled jobs | Checks, heartbeat stale, escalation, correlation, SLO burn, maintenance, retention, optional auto-heal / autonomous automation |
| **shared** | `@opswatch/shared` | Enums, Zod payloads, failure classification, LLM Zod parsers |
| **opswatch-client** | `@opswatch/client` | HMAC-signed heartbeat / event / health-snapshot helper for monitored apps |

```
┌─────────────┐     session cookie      ┌─────────────┐
│  apps/web   │ ──────────────────────► │  apps/api   │
└─────────────┘                         └──────┬──────┘
                                               │ Prisma
                                               ▼
                                        ┌─────────────┐
                                        │ PostgreSQL  │
                                        └──────▲──────┘
                                               │
┌─────────────┐   signed ingest               │
│ Monitored   │ ──────────────────────────────┤
│ app + SDK   │   /heartbeat /event           │
└─────────────┘                               │
                                              │
┌─────────────┐   exclusive job runners       │
│ apps/worker │ ──────────────────────────────┘
└─────────────┘
```

---

## 2. Product surfaces ↔ code

| Product surface | Primary UI | Primary API / services |
|-----------------|------------|-------------------------|
| **Applications** | `/apps` → `/projects`; register wizard | `projects.routes`, `projects.service`, ingest credentials |
| **Topology** | `/projects/[id]/topology` | `topology.service`, `topology-loader`, `Service` + `ServiceDependency` |
| **Incidents** | `/incidents`, project incidents | `incidents.service`, correlation groups, causal graph |
| **Alerts** | `/alerts` | `alerting.service`, check/heartbeat/event sources |
| **Intelligence** | `/intelligence` | `intelligence/*`, prediction gate (off by default) |
| **Connect** | Register wizard; org API keys | `OrgApiKey`, project `apiKey`/`signingSecret`, ingest middleware |
| **Heartbeats** | Project activity / freshness | `POST /heartbeat`, worker `processHeartbeatStaleJob` |
| **Automation** | `/automation`, playbooks | playbooks, planner, run executor, worker autonomous job |
| **Checks (agentless)** | `/checks`, project checks | `health-checks/*`, worker HTTP/SSL jobs |
| **SLOs** | Project reliability | `SLODefinition` / `SLOWindow`, burn-rate job |
| **Layer health** | Analytics / dashboard tables | `layer-health-rollup.service` |

---

## 3. Data flows (current)

### 3.1 Agentless monitoring (Approach A)

1. Operator creates **Project** (Application) + **Service** nodes + **Check** rows.
2. Worker runs HTTP/SSL/keyword/response-time (and related) jobs → `CheckResult`.
3. Failures escalate via alerting → optional **Incident** correlation.
4. Recoveries resolve alerts/incidents via resolve / escalation jobs.

### 3.2 Connected / SDK ingest (Approach B partial)

1. Connect provisions project signing secret + API key (`project-ingest-credentials`).
2. Client sends signed `POST /heartbeat` / `/event` / `/health-snapshot`.
3. Middleware verifies HMAC + replay nonce → persist `Heartbeat` / `Event`.
4. Intelligence observation path records facts; stale heartbeat job raises alerts.

### 3.3 Operations → automation (governed)

1. Incident / alert context → remediation suggest / automation plan.
2. `AutomationPolicy.executionMode` (`OBSERVE` default) and approvals gate execution.
3. Executors write `RemediationLog` / run steps; outcomes feed learning stores (predictions still gated).

---

## 4. Tenant & identity model

```
Organization
  ├── User[] (+ UserSession)
  ├── OrgApiKey[]
  ├── Project[]          ← monitored “Application”
  │     ├── Service[]
  │     ├── Check / Event / Heartbeat / Alert / Incident
  │     └── ProjectIntegration / ProjectBilling
  ├── Subscription / PlanEntitlement usage
  └── Intelligence + ChangeEvent / DeploymentRecord (org-scoped)
```

- Multi-tenant boundaries are **organizationId**-scoped on intelligence, automation, billing, and org API keys.
- Projects may have `organizationId` nullable in schema historically; product path assumes org attachment for multi-tenant features.

---

## 5. Worker job map

| Job | Purpose |
|-----|---------|
| `runHttpChecksJob` | Agentless HTTP (+ related check types via check runner) |
| `runSslChecksJob` | SSL / cert freshness |
| `processHeartbeatStaleJob` | Missed heartbeats → alerts |
| `processAlertEscalationJob` | Escalate / promote severity |
| `resolveIncidentsJob` | Auto-resolve when sources recover |
| `runIncidentCorrelationJob` | Org-level correlation groups |
| `evaluateSloBurnRateJob` | SLO windows / burn |
| `runIncidentAutoHealJob` | Optional auto-heal (policy gated) |
| `runAutomationAutonomousJob` | Autonomous playbook runs when allowed |
| `runMaintenanceWindowTransitionsJob` | Schedule → active → completed |
| `pruneRetentionJob` | Retention policy enforcement |

Jobs use exclusive runners to avoid overlapping executions.

---

## 6. Current topological model (four-layer)

Within a **Project**, services use `ServiceType`:

- Product layers: `APP` | `MODULE` | `WORKFLOW` | `COMPONENT`
- Legacy infra types: `FRONTEND`, `API`, `DATABASE`, `WORKER`, `WEBHOOK`, `EMAIL`, `PAYMENT`, `THIRD_PARTY` (mapped to COMPONENT in topology)

**Org roll-up today** (`layer-health-rollup.service`):

| Roll-up layer | Source |
|---------------|--------|
| APPLICATION | `Project.status` counts for org |
| MODULE / WORKFLOW / COMPONENT | `Service.type` + `Service.status` |

There is **no** Region / Location / Branch entity — see [08-branch-aware-location-design.md](./08-branch-aware-location-design.md).

---

## 7. Feature / safety gates (architecture-level)

| Gate | Mechanism | Default |
|------|-----------|---------|
| Predictions product emission | `OPSWATCH_PREDICTIONS_ENABLED` + confidence | **OFF** |
| Pattern display | `displayEligible` + `OPSWATCH_MIN_DISPLAY_CONFIDENCE` | Conservative |
| Ingest signing | `INGEST_SIGNING_REQUIRED` | Required unless explicitly false |
| Automation mode | `AutomationPolicy.executionMode` / playbook governance | OBSERVE / approval |
| Auto remediation | Env + entitlement + maintenance policy | Conservative |
| Plan entitlements | `PlanEntitlement.featureKey` | Per plan |

---

## 8. Gaps vs target product architecture

| Target concept | Current | Gap severity |
|----------------|---------|--------------|
| Universal Connection Framework | Wizard + HMAC SDK + integrations tiles | Medium — no OTEL/collector, no unified connection abstract |
| Adaptive Operational Graph | Service + ServiceDependency + causal graph | Medium — project-scoped; no site graph |
| Locations / Sites | `Project.defaultRegion` string only | High for multi-branch |
| Change Ledger | `ChangeEvent` + `DeploymentRecord` | Low–medium — ledger exists, CMDB workflow thin |
| RCA | Incident diagnosis + causal graph + memory | Medium — governed AI Brain still partially proposed |
| Branch-aware health | Org 4-layer only | High for site vs org roll-up |
| Industry portability | Some EventTypes / docs are logistics-flavoured | Medium — see compatibility risks |

---

## 9. Explicit Phase 1 boundary

This map describes **what exists**. No code or schema was changed to produce it.
