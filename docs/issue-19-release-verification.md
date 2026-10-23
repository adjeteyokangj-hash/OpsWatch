# Issue 19 implementation and release verification

Status: implemented in [draft PR 20](https://github.com/adjeteyokangj-hash/OpsWatch/pull/20), with release validation in progress. No production deployment or production database change is authorised by this report.

## Baseline and preservation

Implementation extends GitHub main `66f61d7b8a2dbeb2aad84d5a418d6102f34d8fc8` in an isolated worktree on `codex/issue-19-audit`. Original checkout modifications, untracked configuration and release folders were preserved. PR 16 recovery/learning work and PR 18 catalogue foundation are retained. The historical source audit is in [the audit report](issue-19-audit-and-implementation-plan.md).

## Changes delivered

| Area | Implementation | Evidence boundary |
| --- | --- | --- |
| Deployment safety | Removed SQL helper from Vercel build; explicit approval guard before helper configuration/database access; CI follows lifecycle aliases and helper imports to reject automatic migrations. | No migration helper was executed with approval. |
| Catalogue | Existing platform catalogue plus tenant custom definitions, optimistic versioned management/archive, persisted project assignments, owner notes, approve/reject/remove, and audit records. | Approval records application intent; it never installs a component or creates health evidence. |
| Discovery | Application descriptions, optional public website title/description and successful scoped API topology-import capabilities; optional schema-constrained model proposals with exact source quotes, confidence, approval state, rate/token/time limits and credential redaction. Website outcomes are classified as not requested, no website configured, analysis failed (empty response or inspection failure) or analysis completed. | Model/website access requires an explicit request; model discovery also requires its disabled-by-default feature flag and credential. No real model call was made during tests. |
| Topology | Explicit mapping of approved assignments to existing confirmed same-project canonical modules; successful imports refresh proposals; unique edge counting, explicit discovery versus awaiting-monitoring states, generic property ordering. Incident-memory fetch depends on a derived relationship edge id rather than partial `selectedEdge` fields, clearing the prior exhaustive-deps warning without suppressing lint. | Existing canonical topology remains authoritative. No synthetic nodes, relationships or healthy states are created. |
| AI Operations | Project-level capability page, independent partial status fallback, overdue/failing worker diagnostics, scoped decision/prediction evidence, separate Phase 9/legacy learning counts, and recent actual model-call outcomes. | Configuration alone cannot report verified provider availability. Worker infrastructure is shared and labelled accordingly. |
| Monitoring coverage | Requires an active monitor and a fresh actual check result; payment/webhook endpoints are labelled as endpoint monitoring. | A tracked gap, integration row or isolated business event is not full journey coverage. |

Website metadata requests pin validated public DNS answers, use HTTPS with normal host verification, reject redirects/private addresses and bound response size/time. Website content is untrusted evidence, never executable instructions. API mutations retain session CSRF protection and administrator checks. Composite database foreign keys also prevent cross-project/tenant component bindings.

Browser verification uncovered two additional runtime defects: a router-wide platform billing gate blocked ordinary authenticated requests to subsequent routers, including AI Operations; and concurrent initial plan seeding could fail with a unique-key race. The gate now applies only to platform billing paths, whose restrictions remain tested. Plan/entitlement seeding retries a unique-key race once; outages and persistent conflicts still fail. These are reproduced code-level causes, not proof of a retrospective production incident cause.

### Consolidated follow-up (same worktree / PR 20)

Continuing from commit `31df66a` in `.worktrees/issue-19` without touching the outdated main checkout:

1. **Website discovery status** — requested analysis with no frontend URL now records `website_url_missing` (`no_website_configured`). Skipped analysis remains `website_metadata_not_requested`. Configured URL with empty or failed inspection records `analysis_failed` (`website_metadata_empty` or `website_metadata_unavailable`). Successful metadata collection is `analysis_completed` and is admitted as evidence.
2. **Topology hook** — `incidentMemoryEdgeId` is derived before the effect so relationship memory loads when a non-hierarchy edge is selected and clears otherwise. No `eslint-disable` was added. Property-focus highlighting, edge resolve, canvas selection and focus collapse remain covered by the web topology regressions above.
3. **Discovery evidence refresh** — re-analysis already updates `confidence` / `evidenceJson` for undecided `PROPOSED` rows via `updateMany` (owner APPROVED/REJECTED/REMOVED remain untouched). Connected API imports now feed `proposeProjectModules` with `connectedApi.verified` plus declared `capabilitiesJson` keys, not free-text-only matching.
4. **GET applicability hints** — project catalogue read includes custom-definition extensions and returns `proposals` as read-only hints; the Modules panel surfaces them separately from assignments and topology health.
5. **AI discovery diagnostics** — empty completed model runs record `ai_insufficient_evidence`; HTTP and invalid-response failures are distinct from transport `PROVIDER_UNAVAILABLE`.

Follow-up local regressions: API discovery/catalogue 18 passed; web catalogue panel 3 passed; earlier website/topology suites remain green. Audit browse UI, canonical-topology feature-flag product default, and live production parity remain out of this local fix set.

These edits are local to the Issue 19 worktree pending inclusion in PR 20. No database reset, production migration or production deployment was performed.

## Migration requirement

One new migration: `apps/api/prisma/migrations/20261023090000_module_catalogue_assignments/migration.sql`.

It adds `ModuleCatalogueDefinition`, `ProjectModuleAssignment` and `ModuleDiscoveryRun`, with tenant/project indexes, scoped foreign keys and assignment/confidence constraints. Two unique indexes are added to existing parent tables to support composite foreign keys. RLS is enabled on the three new tables; public/anon/authenticated access is revoked. The server database role must have the required owner/backend privileges before release. Index creation can briefly lock existing tables and needs a reviewed migration window.

No existing row is backfilled or rewritten, and no previous migration is edited. Approval and component binding remain explicit. The migration is applied only by a separately approved deployment step, never an ordinary build. Before production approval: verify the exact project, schema/history and backend role, take and verify a backup, rehearse against an isolated representative copy, review index duration, then approve the additive migration. Do not reset migration history. Do not use a down migration that deletes assignment/audit evidence; prefer an application rollback retaining the additive tables.

The disposable test harness reconstructs the audited baseline in a newly generated localhost database, applies only the additive SQL, checks schema parity, runs tests and drops only that generated database. This demonstrates schema compatibility; it does not prove that production migration history matches the repository.

## Validation

| Gate | Local evidence |
| --- | --- |
| Migration safety | Five guard tests and lifecycle scan passed. |
| Build | Full workspace production build passed; API compiled again after routing/concurrency corrections. Web rebuilt for final styling. |
| Lint/typecheck | Passed. Topology page `eslint --max-warnings 0` is clean after the incident-memory dependency fix. |
| Follow-up regressions (worktree, uncommitted on `codex/issue-19-release-review`) | Discovery/catalogue: 14 passed across 3 API files (website status classification, SSRF metadata, catalogue controller). Topology selection/focus/highlight: 35 passed across 5 web files (presentation groups including property focus, relationships, focus collapse, canvas selection, edge resolve). Migration guards: 5 passed plus lifecycle scan. |
| Full unit suite | API 654 passed (47 database-gated skips), worker 43 passed (3 database-gated skips), web 228 passed across 53 files. Four additional route-boundary/concurrency tests passed after the runtime corrections. |
| PostgreSQL integration | API 701 passed across 161 files and worker 46 passed across 17 files against disposable PostgreSQL 18; additive migration/schema parity passed. |
| Browser acceptance | Desktop and mobile Chromium both passed against local built servers and a fresh disposable database. Requires a catalogue panel within the viewport, full AI capability payload, persisted approval/note after reload, unchanged topology after approval, custom definition create/archive, foreign-tenant denial and missing-CSRF rejection. Chrome was also exercised. |

The first browser extension exposed the billing-route gate; a subsequent run exposed the plan-seeding race rather than accepting a partial fallback as full readiness. Both were corrected and acceptance rerun. The first GitHub database job failed because shallow checkout omitted the baseline commit; the database job now fetches history. CI runs on Node 22/PostgreSQL 17; local checks used Node 26/PostgreSQL 18. No real model provider calls or live production smoke tests were made.

[CI verified the runtime implementation](https://github.com/adjeteyokangj-hash/OpsWatch/actions/runs/39969253232), including 705 API and 46 worker database tests and both browser projects. Final revision CI is tracked in [PR checks](https://github.com/adjeteyokangj-hash/OpsWatch/pull/20/checks). The screenshots below use disposable fixtures and contain no production data:

| View | Desktop | Mobile |
| --- | --- | --- |
| Approved assignment and evidence | [Screenshot](evidence/issue19/issue19-desktop-assignments.png) | [Screenshot](evidence/issue19/issue19-mobile-assignments.png) |
| Managed catalogue | [Screenshot](evidence/issue19/issue19-desktop-catalogue.png) | [Screenshot](evidence/issue19/issue19-mobile-catalogue.png) |
| Full AI Operations | [Screenshot](evidence/issue19/issue19-desktop-ai-operations.png) | [Screenshot](evidence/issue19/issue19-mobile-ai-operations.png) |

## Production verification blockers

The identified production Supabase project is **OpsWatch / `ndricuhmrfycqrhermul`**. The connected tool denied access to that project. The other connected project was not substituted, and no remote table was created or changed. Production topology, assignments, connection import history, worker execution and provider-call evidence therefore remain unverified.

PR 18 delivered the catalogue/proposal foundation rather than persistent assignments or a complete discovery workflow. Source inspection shows that URL-only onboarding creates public/admin endpoint monitors; those two endpoints cannot establish a complete internal topology. The actual OkangGroup failure must still be distinguished using its real import, assignment, entity and relationship records. Intermittent production AI status likewise needs timestamped configuration/runtime/log evidence; the code corrections do not establish a retrospective production root cause.

Before release acceptance, use read-only access to the correct project and application to verify NiiNai property containers/shared components/relationships, 600-second device monitoring and observe-only policy; reconcile OkangGroup and Oware World source manifests and exact graph identities; verify assignment bindings and worker/capability evidence. Existing fixture tests are compatibility evidence, not a substitute for these live checks. Production deployment and database changes require separate approval after validation.
