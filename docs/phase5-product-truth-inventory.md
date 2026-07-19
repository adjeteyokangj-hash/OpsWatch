# Phase 5 product-truth inventory

Date: 2026-07-19  
Baseline: `acb92e0` on `main`

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. This inventory applies the Phase 5 gate
from `docs/opswatch-observability-programme.md`: visible capability must be
backed by a complete persisted/runtime path or use an honest product-truth
state.

## Shared product-truth vocabulary

- **Live verified** — persisted evidence is produced by an exercised runtime
  path and the UI reads it.
- **Foundation** — prerequisite data contracts or ingestion exist, but the
  named product capability is not complete.
- **Preview** — a real but incomplete path is available for evaluation.
- **Draft** — configuration may be stored, but no execution/monitoring claim is
  made.
- **Not configured** — capability exists but this organization/project has no
  required connection.
- **Feature disabled** — implementation is deliberately gated off.
- **Requires connection** — a supported runtime path needs external setup.
- **Test data** — records are seeded or created by test tooling and are not
  production evidence.

## Inventory

| Visible feature / UI location | Current data source | Backend route or service | Worker execution | Existing tests / flags | Accurate state | Required Phase 5 correction |
| --- | --- | --- | --- | --- | --- | --- |
| Topology replay, project Topology slider | Current topology response plus a client-only `replayMinutesAgo`; no historical graph snapshot is loaded | `GET /projects/:projectId/topology`; canonical loader reads current `Service` / `ServiceDependency` and canonical entities/relationships | None for historical replay | Topology component tests cover rendering; no persisted replay acceptance test | Foundation | Remove the cosmetic slider and replay claim. Keep the current canonical topology explicitly labelled live. State that historical topology replay is unavailable. |
| Operations Timeline, Topology side panel | Live API aggregation of persisted alerts, incidents, checks, changes, automation, and topology context | Existing alert/incident/check routes used by `TopologyLiveOpsFeed`; organization timeline from `buildIntelligenceSnapshot` reads `OperationsTimelineEvent` | Existing monitoring and automation workers create source records; no replay worker | `topology-live-ops-feed.test.tsx`; Intelligence service tests | Live verified event history | Rename/describe as persisted event history, not historical graph replay. Keep links to source evidence and a Return to live action where topology context can be paused. |
| Synthetic journeys, Product Insights | `SyntheticJourney` draft rows and generated recommendations/templates | `/insights/product`, `/insights/journeys/templates/:key/create`; `product-insights.controller.ts` | No scheduled journey executor, ordered step runner, assertion engine, screenshot store, run history, alert/incident/recovery lifecycle | Controller paths create `status: DRAFT`; no end-to-end executor tests or execution flag | Draft | Label the entire feature `Draft — execution not yet enabled`. Do not describe a draft as monitoring or active. Remove `SYNTHETIC` from available runtime catalogue choices. |
| Logs, project Logs tab | No central searchable log store. OTEL log-derived operational evidence can feed the Phase 3 alert/incident spine, but log records are not searchable here | OTEL bridge and project status services; no log search route | OTEL processing exists; no log indexing/search worker | Phase 3 OTEL tests; no log-search tests | Foundation | Add shared Foundation state and explain exactly what exists, what does not, and setup required. Remove stream/activity/count claims. |
| Security Command Centre | Platform auth, credentials, roles, audit, replay protection, and automation policy are real; no threat/event analytics store for the claimed centre | Auth/settings/credential/audit routes; no threat detection, vulnerability, attack-path or containment service | Credential expiry and existing operational jobs only | Credential-security and auth tests; Phase 8 not started | Foundation | Replace phase-number/planned intelligence copy with current control coverage and missing evidence sources. Do not show seeded findings or threat claims. |
| Intelligence baselines | Persisted `LearningBaseline` rows harvested from checks; readiness is sample-count based | `GET /intelligence`; `brain-snapshot.service.ts` | Harvest currently occurs best-effort on API read, not a prediction worker | Intelligence service tests and confidence thresholds | Preview | Identify this as calculated baseline evidence, distinct from diagnosis, recommendations and predictions. |
| Intelligence patterns/diagnosis/recommendations | Persisted operational patterns and incident memory; Product Insights also contains deterministic heuristics and name/text classification | `/intelligence`, `/insights/product`; `brain-snapshot.service.ts`, `product-insights.controller.ts` | No Phase 9 learning engine | Confidence/service tests | Preview | Label calculated/inferred outputs. Do not present heuristic recommendations as learned AI findings. |
| Predictions, Intelligence and Dashboard | Feature-gated framework and candidate tables; current product can count stored candidates, including stale/seeded rows | `/intelligence`; `prediction-gate.service.ts` | No verified Phase 9 candidate-generation/feedback worker | `OPSWATCH_PREDICTIONS_ENABLED`; prediction gate tests | Feature disabled | Force honest disabled product emission and display zero candidates while disabled. Explain that stored rows are not live predictions. Prediction cards require persisted evidence and confidence when a future phase enables them. |
| Discovery state on topology/components | Canonical provenance, `lastObservedAt` and relationship records exist; some UI copy infers state from names or generic absence | Canonical topology loader and Phase 4 topology API | Phase 3/4 writers populate canonical records | Phase 4 topology tests | Live verified for canonical records; otherwise Discovery pending | Use only canonical states: Declared, Discovered, Manually confirmed, Discovery pending, Stale, No mapped dependencies, Test/seed data. Prefer provenance/freshness over names. |
| Automation states | Persisted `AutomationRun`, approvals, outcomes and verification fields; provider capabilities can be incomplete | Automation/remediation routes and services | Existing worker executes verified actions such as `restart_sync_worker`; other catalogue-like actions may be planning only | Automation safeguards, approval and worker job tests; emergency/policy gates | Live verified only per registered executor; otherwise Requires connection / Feature disabled | Keep actual run state separate from recommendation/planning state. Never imply unsupported provider actions execute. |
| Connection registry | Persisted connections with create/test/save, credential lifecycle and status | `/connections`, `/connections/:id/test`, credential services | Agentless/API checks have runtime paths; ingest modes receive runtime evidence | Connection controller/service and browser tests | Available for complete runtime modes | Preserve Available only for complete paths. |
| Connection catalogue modes | Manifests advertise `SYNTHETIC`, cloud, database and custom contracts although no complete runtime path exists | `connection-manifest.service.ts` | No executor/synchronizer for manifest-only modes | Manifest validation tests only | Preview / Planned / Requires configuration | Add explicit availability metadata. Available: Agentless HTTP/API, heartbeat, webhook, OTEL and SDK ingest where configuration requirements are met. Synthetic/cloud/database/custom are Preview or Planned and cannot be started as monitoring. |
| Infrastructure/serverless/network surfaces | No dedicated complete runtime product pages found; topology can render infrastructure-shaped canonical entities when supplied by real records | Canonical topology API | Existing topology writers only | Phase 4 topology tests | Foundation / Requires connection | Avoid dedicated monitoring claims. Empty states must say which topology/OTEL/connection evidence is required. |
| Deployment/change views | Persisted `ChangeEvent` and calculated `DeploymentRecord` correlation windows | Project deployments/change routes; `deployment-intelligence.service.ts` | Ingest paths persist events; snapshot sync calculates deployment records | Intelligence/deployment tests | Live verified for recorded change; calculated correlation | Label recorded deployment facts separately from calculated in-window alert/incident counts. Do not claim causality. |
| Reports landing page | Static links and broad descriptions; target pages contain a mix of persisted counts and calculated metrics | `/analytics/*`, `/insights/product`, accuracy/status routes | Depends on source feature | Existing smoke coverage is broad, not product-truth-specific | Preview | Classify report cards as Live calculated, Preview, or Requires configuration. Remove unsupported trend and “healthy” claims from empty states. |
| Operations analytics | Aggregates persisted incidents/actions where present; trend/MTTR language can imply more completeness than evidence supports | Operations analytics controller/routes | None beyond source workers | Existing controller tests | Live calculated | Mark calculated scope/time window and show unavailable states instead of fabricated percentages/trends. |
| Product Insights | Deterministic calculations and name/text heuristics over persisted records; can create configuration drafts | `/insights/product` and action routes | No AI or synthetic executor | Product insights tests | Preview / Calculated | Identify inference and calculation. Draft journey actions must remain Draft. |
| Check accuracy | Persisted action/check outcomes where available; empty states can overstate “healthy” | Accuracy routes/pages | Existing source jobs | Existing UI tests | Live calculated when evidence exists; unavailable otherwise | Replace “healthy” from absence with an evidence requirement. |
| Dashboard KPIs | Counts from live API records; some recommendation/empty copy equates absence with health | `/projects`, `/alerts`, `/incidents`, `/checks`, `/insights/product`, `/intelligence` | Source workers | Dashboard tests/smoke | Live calculated per successfully loaded source | Add source-state labels and avoid “monitoring healthy” or “looks healthy” when there is no evidence. |
| Seeded/demo dashboards and Noble fixtures | Seed scripts create graph, playbook and monitoring records that are indistinguishable in generic UI unless names reveal them | Seed/setup scripts and normal APIs | Some seeds can later receive real execution | Script-specific checks | Test data until independently live verified | Add a reusable test/seed indicator based on explicit environment/provenance markers, plus a non-test diagnostic when test/seed entities appear. Never rely on display-name heuristics. |

## Decisions

### Historical topology

The current slider is cosmetic. It changes a presentation input but does not
request a historical graph, read snapshots, or reconstruct topology from
versioned persisted relationships. Building the snapshot schema, retention,
reconstruction API and runtime evidence would be a new capability beyond the
honest Phase 5 correction. Phase 5 will remove the slider, retain the canonical
live topology, retain persisted Operations Timeline event history, and state
that historical topology replay is unavailable.

### Synthetic journeys

Only draft persistence and recommendation/template creation exist. There is no
scheduled executor, step/assertion runtime, timeout/retry model, screenshot
evidence, run history, or alert/incident/recovery lifecycle. Phase 5 will keep
the draft model and creation path but mark it `Draft — execution not yet
enabled`; drafts will never appear as active monitoring.

### Predictions

Prediction product emission remains disabled. The UI and API must report zero
active candidates while disabled even if old rows exist in storage. Baselines,
calculated patterns, deterministic recommendations and incident diagnosis are
separate evidence types and must not be called predictions.

## Phase boundary

This work does not add searchable logs/APM (Phase 6), new remediation providers
(Phase 7), threat detection/containment (Phase 8), learning/prediction (Phase
9), or native Datadog/Dynatrace connectors (Phase 10). It does not remove or
replace the Phase 4 `Service` / `ServiceDependency` compatibility model or the
canonical topology reader/writer path.
