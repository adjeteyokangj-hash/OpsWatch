# 04 — Reusable Services & Components Inventory

**Phase:** 1 assessment  
**Intent:** Prefer extend-over-rewrite for Phases 2–10.

---

## 1. Packages

### `@opswatch/shared` — `packages/shared/src/`

| Module | Reuse for |
|--------|-----------|
| `enums.ts` | Cross-app status/type vocabulary (align with Prisma in Phase 2) |
| `types.ts` | Heartbeat/Event/HealthSnapshot contracts |
| `schemas.ts` | Zod validation for ingest |
| `constants.ts` | Heartbeat stale / HTTP alert rules |
| `failure-classification.ts` | Agentless failure taxonomy |
| `llm-schemas.ts` | Bounded LLM parse for diagnosis / playbooks |

### `@opswatch/client` — `packages/opswatch-client/src/`

| Module | Reuse for |
|--------|-----------|
| `heartbeat.ts` / `event.ts` | Connect Approach B ingest |
| `signatures.ts` | HMAC client helpers |
| `health.ts` | Health snapshot builder |
| `config.ts` / `api-base.ts` | Env wiring for apps |

**Extend later:** OTEL exporter shim, connection-type plugins — do not replace HMAC path.

---

## 2. API services (by domain)

### Topology / health

| Path | Capability |
|------|------------|
| `apps/api/src/services/topology.service.ts` | Graph build; type → layer mapping |
| `apps/api/src/services/topology-loader.service.ts` | DB load |
| `apps/api/src/services/layer-health-rollup.service.ts` | Org APPLICATION/MODULE/WORKFLOW/COMPONENT counts |
| `apps/api/src/services/project-health.service.ts` | Project status aggregation |
| `apps/api/src/services/service-health.service.ts` | Per-service health |
| `apps/api/src/services/dependency-impact.service.ts` | Blast radius by layer |

**Phase 3+:** Add Location-scoped roll-up wrappers; keep existing Project roll-up as System view.

### Ingest / Connect

| Path | Capability |
|------|------------|
| `heartbeats.service.ts` / `events.service.ts` | Persist signals |
| `project-ingest-credentials.service.ts` | Provision live keys |
| `ingest-replay.service.ts` + middleware | Nonce window |
| `lib/request-signature.ts` | HMAC verify |

### Agentless checks

| Path | Capability |
|------|------------|
| `checks.service.ts` | CRUD / listing |
| `health-checks/http-check.service.ts` | HTTP probe |
| `health-checks/ssl-check.service.ts` | TLS |
| `health-checks/keyword-check.service.ts` | Body keyword |
| `health-checks/response-time-check.service.ts` | Latency |
| `health-checks/domain-expiry-check.service.ts` | Domain expiry |

### Incidents / alerts / RCA precursors

| Path | Capability |
|------|------------|
| `incidents.service.ts` | Lifecycle, timeline, root-cause fields |
| `alerting.service.ts` | Create/resolve + maintenance suppress |
| `incident-causal-graph.service.ts` | Causal graph incl. ChangeEvents |
| `incident-causal-graph-loader.service.ts` | Load graph data |
| `ai/incident-analysis.service.ts` / `incident-ai.service.ts` | Diagnosis (LLM opt-in) |
| `ai/incident-memory.service.ts` | Memory entries |

### Intelligence

| Path | Capability |
|------|------------|
| `intelligence/prediction-gate.service.ts` | **Must remain** product emission gate |
| `intelligence/confidence.service.ts` | Scores + displayEligible |
| `intelligence/observation.service.ts` / `pattern.service.ts` / `learning.service.ts` | Facts → baselines → patterns |
| `intelligence/dependency-learning.service.ts` | Edge evidence |
| `intelligence/deployment-intelligence.service.ts` | Deploy correlation |
| `intelligence/brain-snapshot.service.ts` | Dashboard snapshot |
| `intelligence/intelligence-constants.ts` | Env thresholds |

### Automation / remediation / governance

| Path | Capability |
|------|------------|
| `automation/automation-planner.service.ts` | Plan generation |
| `automation/automation-run-executor.service.ts` | Step execution |
| `automation/playbook-governance.service.ts` | Version review |
| `automation/automation-safeguards.service.ts` | Safety checks |
| `automation/automation-llm-planner.service.ts` | Optional LLM planner |
| `remediation/remediation.service.ts` / `auto-heal.service.ts` / `auto-run-policy.service.ts` | Suggest / heal / policy |
| `remediation/executors/*` | Typed action executors |
| `maintenance-window-policy.service.ts` | Maintenance gates |

### Entitlements / billing

| Path | Capability |
|------|------------|
| `entitlements/entitlement-keys.ts` | Feature key catalogue |
| `entitlements/entitlement.service.ts` / `subscription-access.service.ts` | Gates |
| `entitlements/plan-definitions.ts` | Plan packs |
| `billing.service.ts` / `billing/stripe.service.ts` | Commercial |

### Integrations / providers

| Path | Capability |
|------|------------|
| `integration-validation.service.ts` | Validate connections |
| `providers/github.service.ts` / `vercel.service.ts` / `render.service.ts` | Deploy/provider hooks |

---

## 3. Worker jobs (reuse)

All under `apps/worker/src/jobs/` — see [01](./01-existing-architecture-map.md) §5.  
Exclusive runner: `apps/worker/src/lib/exclusive-job.ts`.

**Phase 5+:** Add OTEL batch ingest / location roll-up jobs without replacing check loop.

---

## 4. Web components (reuse)

| Area | Paths |
|------|-------|
| Shell / nav | `apps/web/src/components/layout/{shell,sidebar,header}.tsx` |
| Topology | `components/topology/*` (canvas, layers, drawers, live-ops, list) |
| Connect | `components/projects/register-application-wizard.tsx`, `register-wizard-ui.tsx` |
| Applications | `applications-portfolio-cards.tsx`, `project-workspace-shell.tsx`, `project-layer-page.tsx` |
| Health | `components/health/*` |
| Incidents | `components/incidents/*` |
| Integrations | `components/integrations/*` |
| Intelligence page | `app/intelligence/page.tsx` |

**Preserve:** light theme, prediction-disabled UI honesty, Applications → Projects redirect pattern until System naming ships.

---

## 5. Controllers / routes worth extending (not rewriting)

- Ingest: `heartbeats.routes.ts`, `events.routes.ts`
- Topology: projects topology endpoints + `analytics.routes` layer-health
- Org keys: `org.routes.ts`
- Incidents change-events: `incidents.routes.ts`
- Intelligence: `intelligence.routes.ts`
- Automation: `automation.routes.ts`

---

## 6. Do-not-duplicate list

| Concern | Existing home — extend this |
|---------|------------------------------|
| HMAC signing | `request-signature` + client `signatures` |
| Prediction gating | `prediction-gate.service` |
| Layer health math | `layer-health-rollup.service` (wrap for Location) |
| Playbook execution | `automation-run-executor` |
| Ingest credentials | `project-ingest-credentials` |
| Failure taxonomy | `packages/shared/failure-classification` |

---

## 7. Thin areas (build net-new later)

| Capability | Notes |
|------------|-------|
| Location / Region models & APIs | Design in [08](./08-branch-aware-location-design.md); implement Phase 3 |
| OTEL collector receiver | Phase 5 |
| Formal Change Ledger workflow UI | Extend `ChangeEvent` Phase 6 |
| Universal Connection abstract | Facade over ProjectIntegration + ingest + OTEL Phase 2 |
| Industry Monitoring Profile packs | Phase 2–3 |
