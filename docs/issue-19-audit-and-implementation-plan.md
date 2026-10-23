# Issue 19: audit checkpoint 2 and proposed implementation

Date: 23 October 2026. Stage: repository reconciliation and code gap analysis. No product implementation or production changes authorised at this checkpoint.

## Baseline and preservation

Fetched `origin/main`: `66f61d7b8a2dbeb2aad84d5a418d6102f34d8fc8`.
Created branch `codex/issue-19-audit` and worktree `.worktrees/issue-19` from that exact commit. PR 16 merge `135ace7db41b73cdb35cc4bbc8bcba43657b9487` is an ancestor. PR 18 is the baseline merge.

The original checkout remains on main at `2c1104e71695a69774927817c630546d40c290f9`. Its existing modified files, untracked scripts, configurations and release folders were not merged, reset, stashed or overwritten. Fetch changed remote tracking metadata only. The added worktree and pnpm package store appear as additional untracked `.worktrees/` and `.pnpm-store/` directories in the original checkout. Its tracked modification list remains `.gitignore` and `apps/web/src/middleware.ts`.

No environment files were copied into the worktree. No database connection, migration application, seed, backfill, production request or deployment was performed. Schema findings describe repository definitions, not proof of the deployed schema or migration state.

## What PR 18 delivered

The merge changes nine files, with 220 insertions and 12 deletions relative to its first parent:

* `apps/api/src/services/topology/module-catalogue.service.ts`: twelve static module definitions; keyword and simple plural matching; deduplication by key; per-invocation custom extensions; proposals with sources, evidence, state and approval requirement. It never creates services or monitoring.
* `apps/api/src/controllers/module-catalogue.controller.ts` and `apps/api/src/routes/projects.routes.ts`: tenant-scoped GET `/projects/:projectId/module-catalogue`. It reads project description/name and configured URL hostname, and explicitly reports PARTIAL discovery.
* `apps/api/src/services/topology/module-catalogue.service.test.ts`: focused proposal tests.
* `apps/api/src/services/topology-loader.service.ts`: reader diagnostics are now exposed without the previous conditional checks at those sites.
* Intelligence and topology pages plus `ai-operations-status.tsx`: distinguish failed status requests from disabled AI.
* `docs/integrated-ai-topology-catalogue-release.md`: incomplete-release contract and historical screenshot observations.

It does not fetch website content, call an AI model, retrieve connected API capabilities from the catalogue controller, persist assignments, implement approval writes, provide a browsable catalogue, or alter the schema. The proposal helper accepts a connectedApi argument, but the endpoint does not supply it. A helper proposal called `verified` is still approval-required and is not runtime health evidence.

PR 16 already supplies Phase 9 versus legacy learning counters, exposed Phase 9 snapshot errors, learning readiness recovery and worker-versus-diagnosis distinctions. Those behaviours must remain. Its prediction filtering must not be assumed to cover every other status query.

## Gap matrix

“Existing” below means found in code. Runtime operation is unverified unless a test result is recorded in the validation section.

| Area | Existing functionality | Incomplete or missing | Defect or integration requirement | Required verification |
| --- | --- | --- | --- | --- |
| Catalogue definitions | Static keys, labels, keyword terms and invocation-scoped extensions | Descriptions, categories, capabilities, applicability, version, lifecycle, parent/dependencies and tenant custom persistence | Extend the existing service rather than introduce an unrelated registry; distinguish core, optional and custom definitions | Stable keys, dependency validation, custom tenant isolation and duplicate constraints |
| Application assignments | Read-only proposals scoped through project ownership | Durable assignment/rejection, manual edits, approvals, numeric confidence, timestamps and audit | Approval must not create a running service or healthy status; rejected/manual choices survive reanalysis | Owner/admin RBAC, cross-tenant denial, concurrent approvals, idempotency and audit |
| Discovery | Description/name and URL-hostname keyword inference | Actual website metadata collection, authenticated API capability input, model-assisted proposals, bounded reanalysis and capability-change trigger | Reuse outbound URL safety and connection-secret handling; remote content is untrusted data; model output must validate against permitted definitions | Private IP/DNS/redirect protections, timeout, rate limits, malformed content, injection, unavailable model and no fabricated capabilities |
| Topology storage | OperationalEntity/OperationalRelationship canonical graph; legacy Service compatibility and identity mapping | All-project parity and cutover evidence | Canonical reader is opt-in through OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED; preserve explicit legacy fallback and health bindings | Compare persisted identities/edges with response counts, stale/deleted sources, unbound connections and tenant isolation |
| Topology ingestion | Authenticated API manifest fetch; bounded components/relationships; transactional reconciliation and scheduled sync | Verify real connections and discovery manifests per application | Active API connection, bound project and discoveryPath are required; no catalogue approval should bypass these | Actual NiiNai, OkangGroup and Oware World source and binding inventory; duplicate/repeated import tests |
| Topology presentation | Common canvas/list, property groups, shared modules, focus/zoom, relationship drawers and monitoring overlays | Generic applicability beyond hospitality assumptions and accurate counters | Name-based discovery inference and module-incidence relationship totals need correction; preserve NiiNai grouping through metadata | Property fixtures, shared module uniqueness, endpoint-only app, edge count agreement, mobile, filters and zoom retention |
| Health | Check/heartbeat evidence, declared health bindings, hierarchy rollups and legacy compatibility | Explain endpoint health separately from application/module coverage | Healthy public/admin checks alone do not establish healthy internal modules. Legacy response project.status is stored separately from node health | Mixed fresh/stale checks, missing hierarchy/binding, observe-only heartbeat and 600-second offline policy |
| AI Operations status | Org/project endpoint with permissions, effective policy snapshot, worker tick/job evidence, learning/prediction/diagnosis cards and recent decisions | Cohesive Centre, resilient partial responses, verified model runtime, unified status semantics | One failed Promise rejects the whole endpoint; some project displays still read org-wide evidence; runtime summary can disagree with capability cards | Missing worker tables/evidence, stale/partial/failing tick, project isolation, explicit disabled versus insufficient samples |
| Learning and predictions | Phase 9 baseline/anomaly pipeline, incident matching, prediction review and outcome infrastructure | End-to-end proof from check through learned outcome | Preserve PR 16; status latest/count prediction queries do not apply expiresAt/confidence emission filters; baseline activity counts are not readiness proof | Expired/insufficient/rejected candidates, load errors, confidence gates, outcome/expiry and no automatic high-risk action |
| Insights coverage | Coverage calculations and gap-recording recommendation actions | Evidence freshness and active binding criteria across coverage dimensions | Some predicates accept integration presence or event occurrence; cannot assume that means active monitoring | Tracked gap remains uncovered; inactive/unbound/stale integration and valid check cases |
| Release gates | Lint/typecheck/tests/build workflow and migration guard | Database/browser acceptance execution and deployment parity | Guard passes despite vercel-build invoking a SQL migration helper | Guard catches indirect migration scripts; all CI stages plus isolated database and browser tests |

## Why OkangGroup shows only two endpoints

The source of the exact labels is `url-monitoring-provisioning.service.ts`: PUBLIC becomes “Public website” and ADMIN becomes “Admin endpoint”. URL onboarding creates EXTERNAL_URL services with checks and canonical WEBSITE/ADMIN_PORTAL entities. It does not discover the application's internal business modules.

The catalogue GET is a separate read-only path. Even successful suggestions cannot add topology nodes or edges. Therefore missing assignments and missing topology ingestion are different conditions; adding assignments alone will not fix a sparse graph.

`connection-topology-discovery.service.ts` only schedules active API connections with a project, acceptable installation status and a nonempty discoveryPath. Manifest fetch validates the configured origin, resolves the configured credential, refuses redirects and applies a timeout. Without a successful manifest/telemetry import, endpoint-only monitoring is expected.

Two presentation problems are established by source inspection:

1. `topology-relationship.ts::resolveConnectionState` infers discovery_incomplete from names matching portal/website/system/centre/center, even without an actual discovery job. “Discovery Pending” can therefore be a UI heuristic, not an ingestion runtime state.
2. `summarizeRelationshipDiagnostics` filters to module nodes and sums their incident edge counts. It is not a unique graph-edge count: it can omit non-module edges or double count module-to-module edges.

Reader selection is a separate possible cause: with canonical reads disabled, canonical-only entities will not be read; with a reader failure, legacy fallback diagnostics should identify the fallback. Legacy project.status and node check health are also separate inputs; healthy endpoint nodes do not guarantee application status changes.

**Production root cause remains unconfirmed.** The historical screenshot described in the release document is not a live database/API snapshot. Required read-only evidence: actual project ID/org, active connections and linkedServiceId, discoveryPath presence (no secrets), latest sync result/error, canonical and legacy node/edge identities, topology response readerDiagnostic, current check freshness, project.status and browser filters. Compare persisted rows to API first, then API to rendered graph. Classify absent import, absent binding, reader selection, absent relationships and rendering separately. Do not repair by inventing modules or edges.

## Why AI Operations shows unavailable or disabled

The actual code path is intelligence/topology page -> GET `/intelligence/operations-status` -> organization and diagnosis:read checks -> optional tenant-scoped project validation -> buildAiOperationsStatus and buildWorkerRuntimeStatus in Promise.all -> mergeAiOperationsRuntimeStatus.

* **Unavailable:** any policy/status database query or WorkerTickRun/WorkerJobState query failure reaches the handler catch and returns 503 for the entire response. Authentication/permission failure, network failure and 503 are all reduced to a generic failed-request message on the topology page. PR 18 correctly stopped treating request failure as proof of disabled AI, but did not remove its cause.
* **Worker unhealthy:** worker proof comes from persisted tick and job records, not an application heartbeat. No tick or a tick older than 15 minutes is red; a failed tick/jobsFailed is red; a tick older than five minutes or deferred/partial work is amber. Per-job failing/overdue/never-run diagnostics exist, but the overall tone primarily uses the latest tick.
* **Disabled:** prediction and learning states use their effective environment flags; automation uses policy, project mode, emergency switches and remediator readiness. An intentionally disabled remediation capability must not disable read-only diagnosis.
* **Insufficient evidence:** prediction enabled with no recent candidate is amber; learning enabled with no activity is amber. Recent baseline counts alone are not proof of sufficient samples or confidence.
* **Provider unknown:** LLM diagnosis checks INCIDENT_AI_LLM_ENABLED and credential presence, explicitly sets liveProviderVerified false, and has no last successful provider-call evidence here. Configured is not reachable.
* **Scope/query defects:** latest AiDecisionAudit is org-wide even in project status. Latest/count prediction queries here include stored candidates without expiry/emission eligibility filtering. Learning baselines are combined in status even though the snapshot distinguishes Phase 9/legacy. These can make project status or readiness misleading.
* **Aggregation defect:** mergeAiOperationsRuntimeStatus changes overall summary while the overall_mode capability retains its original evidence. Worker diagnostics also read global job state; expose infrastructure health without leaking another tenant's details.

**The intermittent production cause remains unconfirmed.** Required read-only snapshot at failure time: HTTP status and request correlation ID, server exception category, deployment SHA, schema/table availability, effective flags as booleans only, project policy, latest tick/job status/error/freshness, last successful provider result and project-specific learning/decision evidence. Do not print credentials, enable flags, execute worker ticks or invoke remediation to diagnose this.

## Consolidated implementation architecture

Keep three separate domains behind shared project/organization identity:

1. Catalogue definitions and approved application assignments describe applicability and owner intent.
2. Discovery runs record source snapshots, bounded analysis and proposed assignments with provenance/confidence. Owner decisions have precedence; repeated source hashes and stable keys deduplicate runs/proposals.
3. Canonical topology remains the runtime graph populated by trusted ingest and explicit health bindings. An assignment may reference a verified entity, but cannot create a healthy component or arbitrary dependency.

Add a typed AI capability contract separating configured, policy eligibility, execution/runtime health, evidence sufficiency and request/load error. Aggregate status from independent providers with explicit missing/error states. Reuse existing diagnosis, review, verification and learning APIs in a navigable Centre; do not create a second execution pipeline. Store redacted provider-call runtime evidence when actual calls occur rather than probe a model on every status GET.

## Proposed file and schema change set

These are planned paths, not implemented changes. Final line-level edits follow review and test baseline.

| Files | Planned change |
| --- | --- |
| apps/api/prisma/schema.prisma; new additive apps/api/prisma/migrations/<timestamp>_module_catalogue_assignments/migration.sql | ModuleDefinition (platform or tenant custom), ProjectModuleAssignment (org/project/definition unique), ModuleDiscoveryRun, ModuleProposal and decision/source evidence records. Foreign keys preserve tenant scope; indexed stable keys/idempotency. No change to old migration files or existing IDs. Explicitly review platform-null uniqueness semantics in PostgreSQL. Reuse existing audit infrastructure for owner actions. |
| apps/api/src/services/topology/module-catalogue.service.ts; new module-assignment.service.ts and module-discovery.service.ts alongside it | Enriched catalogue, durable review/manual choices, deterministic bounded discovery and validated AI proposals; no live graph writes |
| apps/api/src/controllers/module-catalogue.controller.ts; apps/api/src/routes/projects.routes.ts; new module-catalogue.routes.ts | Central browse and scoped discovery/review/manual assignment endpoints with RBAC, validation and audit |
| packages/shared/src: new module-catalogue.ts and export entry | Shared schemas/DTOs for catalogue, assignment, proposal, evidence and discovery status |
| apps/web/src/app/module-catalogue/page.tsx; apps/web/src/app/projects/[projectId]/modules/page.tsx; apps/web/src/components/layout/sidebar.tsx | Catalogue, project Modules view, review/custom/manual actions and truthful unknown states |
| apps/api/src/services/connections/connection-topology-discovery.service.ts; topology-loader.service.ts; canonical-topology-loader.service.ts; topology-reader-safety.ts | Reuse ingestion, surface reader/source/binding diagnostics, compare parity; targeted repair only after actual per-project evidence |
| apps/web/src/components/topology/topology-relationship.ts; topology-presentation-groups.ts; topology-summary-cards.tsx; apps/web/src/app/projects/[projectId]/topology/page.tsx | Evidence-based discovery state, unique edge counters, metadata-based grouping and consistent source/coverage presentation |
| apps/api/src/controllers/intelligence.controller.ts; services/intelligence/ai-operations-status.service.ts and ai-operations-runtime-status.service.ts; services/worker-tick/worker-runtime-status.service.ts | Independent partial status, redacted errors, project scope, eligible prediction/readiness evidence, infrastructure-safe worker details and consistent aggregation |
| apps/web/src/app/intelligence/page.tsx; apps/web/src/components/intelligence/ai-operations-status.tsx; existing navigation | Integrated Centre, project context, errors, diagnosis, approvals and outcome links |
| apps/api/src/controllers/product-insights.controller.ts | Count verified active monitoring evidence separately from recorded coverage gaps |
| apps/web/package.json; scripts/assert-no-automatic-migrations.mjs; .github/workflows/ci.yml | Remove implicit SQL migration from release build, detect indirect migration helpers, add missing regression and disposable database/browser gates |
| Corresponding *.test.ts/*.test.tsx, database-e2e tests and apps/web/e2e acceptance spec; docs/issue-19-release-verification.md | Evidence for the matrix and per-project acceptance |

Catalogue persistence is the one currently identified schema requirement. Provider runtime evidence may use existing audit data if it can represent reachability accurately; otherwise a separate additive migration must be specified for review. Do not apply either migration at this stage. Do not backfill existing modules as approved or verified; deterministic definition seed and explicit mapping need separate review.

## Regressions and acceptance gates

* NiiNai: import existing v11 fixture twice; retain Kanewu and Community 25 containers, shared modules once, every evidence-backed edge, health bindings and observe-only mode; retain 600-second device policy, focus/zoom and mobile layout.
* OkangGroup: endpoint-only fixture shows two endpoints and truthful zero internal modules; no fake pending job. A valid imported manifest appears with exact unique edge counts; missing/failed/unbound discovery has specific reasons. Public URL health does not certify unseen internals.
* Oware World: own project identity/capabilities only, no hospitality defaults; empty source remains unknown. Validate actual registered project separately from fixtures.
* Catalogue: browse, proposal, owner approval, manual edit/reject/remove and reanalysis preserve audit and owner choices; parallel discovery cannot duplicate assignment; cross-tenant IDs denied; viewer cannot mutate; approval never creates monitoring.
* Discovery: SSRF/DNS/redirect, timeout/size limits, rate and token budgets, malicious webpage instructions, credential redaction, provider offline and malformed schema. No source content may authorise tool execution.
* AI: configured versus policy blocked versus insufficient samples versus worker stale versus provider unreachable versus request failure remain distinct; one failing provider does not erase other evidence. Project decision/status cannot borrow another project's activity. Expired/low-confidence candidates cannot become actionable output.
* Pipeline: disposable database test from check/heartbeat through baseline, anomaly, incident, gated candidate, human review and outcome learning. No unattended high-risk action or notifications enabled.
* Release: frozen install, shared build/client generation, lint, typecheck, unit/integration/UI tests, disposable database tests, browser acceptance, build and GitHub CI. Screenshot actual desktop/mobile flows. Record deployment SHA and per-project evidence before release acceptance.

Manual production verification is read-only until release approval: capture each real application's topology/status/connection diagnostics and exact timestamps; reconcile node and edge identities; verify capability state against runtime evidence. No production deployment or configuration change belongs to this checkpoint.

## Validation performed and limitations

* Git baseline and PR 16 ancestry verified; isolated worktree initially clean.
* Schema and migration SQL paths inspected without execution. No catalogue assignment models exist at this baseline.
* `node scripts/assert-no-automatic-migrations.mjs` passed. This is a false assurance for indirect SQL: apps/web/package.json vercel-build invokes apps/api/scripts/apply-niinai-users-migration.mjs, which connects to the database, executes SQL and writes migration history if its tables are missing. Do not invoke vercel-build during this audit.
* Frozen dependency installation completed with lifecycle scripts disabled; lockfile unchanged. Prisma client generation completed without connecting to a database. Shared build initially failed because the Prisma client was not generated; after generation, shared build passed.
* API focused regressions: four files, 15 tests passed (catalogue proposals, AI runtime status merge, worker runtime status and topology reader safety).
* Web focused regressions: three files, 19 tests passed (property presentation groups, topology relationships and AI status rendering). These passing tests verify current expected behaviour, not the correctness of every heuristic identified above.
* Full lint/typecheck/build, database/browser end-to-end tests and GitHub CI were not run at this source-audit checkpoint. No product code was changed; only this report is untracked in the isolated worktree.
* No claim of working production catalogue, topology parity, worker health, provider reachability or completed end-to-end learning follows from this source audit. The two intermittent/live questions require the read-only evidence listed above before targeted repair is approved.

## Proposed implementation sequence after review

1. Complete timestamped runtime evidence and clean test baseline; resolve sparse graph and status errors by their actual observed cause.
2. Review additive schema and shared contracts; implement catalogue and assignments with RBAC/audit and safe discovery.
3. Integrate approved intent with verified topology references; correct generic grouping, diagnostics, health explanations and unique counters.
4. Complete AI Centre using existing pipeline, partial runtime status and scoped evidence; correct monitoring coverage semantics.
5. Run all acceptance gates, prepare one consolidated PR and release report. Production deployment remains a separate approved step after green validation.
