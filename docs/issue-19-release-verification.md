# Issue 19 implementation and release verification

Status: implementation under validation. No production deployment or production database change is authorised by this report.

## Baseline and preservation

Implementation extends GitHub main `66f61d7b8a2dbeb2aad84d5a418d6102f34d8fc8` in an isolated worktree on `codex/issue-19-audit`. Original checkout modifications, untracked configuration and release folders were preserved. PR 16 recovery/learning work and PR 18 catalogue foundation are retained. The historical source audit is in [the audit report](issue-19-audit-and-implementation-plan.md).

## Changes delivered

| Area | Implementation | Evidence boundary |
| --- | --- | --- |
| Deployment safety | Removed SQL helper from Vercel build; explicit approval guard before helper configuration/database access; CI follows lifecycle aliases and helper imports to reject automatic migrations. | No migration helper was executed with approval. |
| Catalogue | Existing platform catalogue plus tenant custom definitions, optimistic versioned management/archive, persisted project assignments, owner notes, approve/reject/remove, and audit records. | Approval records application intent; it never installs a component or creates health evidence. |
| Discovery | Application descriptions, optional public website title/description and successful scoped API topology-import capabilities; optional schema-constrained model proposals with exact source quotes, confidence, approval state, rate/token/time limits and credential redaction. | Model/website access requires an explicit request; model discovery also requires its disabled-by-default feature flag and credential. No real model call was made during tests. |
| Topology | Explicit mapping of approved assignments to existing confirmed same-project canonical modules; successful imports refresh proposals; unique edge counting, explicit discovery versus awaiting-monitoring states, generic property ordering. | Existing canonical topology remains authoritative. No synthetic nodes, relationships or healthy states are created. |
| AI Operations | Project-level capability page, independent partial status fallback, overdue/failing worker diagnostics, scoped decision/prediction evidence, separate Phase 9/legacy learning counts, and recent actual model-call outcomes. | Configuration alone cannot report verified provider availability. Worker infrastructure is shared and labelled accordingly. |
| Monitoring coverage | Requires an active monitor and a fresh actual check result; payment/webhook endpoints are labelled as endpoint monitoring. | A tracked gap, integration row or isolated business event is not full journey coverage. |

Website metadata requests pin validated public DNS answers, use HTTPS with normal host verification, reject redirects/private addresses and bound response size/time. Website content is untrusted evidence, never executable instructions. API mutations retain session CSRF protection and administrator checks. Composite database foreign keys also prevent cross-project/tenant component bindings.

## Migration requirement

One new migration: `apps/api/prisma/migrations/20261023090000_module_catalogue_assignments/migration.sql`.

It adds `ModuleCatalogueDefinition`, `ProjectModuleAssignment` and `ModuleDiscoveryRun`, with tenant/project indexes, scoped foreign keys and assignment/confidence constraints. Two unique indexes are added to existing parent tables to support composite foreign keys. RLS is enabled on the three new tables; public/anon/authenticated access is revoked. The server database role must have the required owner/backend privileges before release. Index creation can briefly lock existing tables and needs a reviewed migration window.

No existing row is backfilled or rewritten, and no previous migration is edited. Approval and component binding remain explicit. The migration is applied only by a separately approved deployment step, never an ordinary build. Before production approval: verify the exact project, schema/history and backend role, take and verify a backup, rehearse against an isolated representative copy, review index duration, then approve the additive migration. Do not reset migration history. Do not use a down migration that deletes assignment/audit evidence; prefer an application rollback retaining the additive tables.

The disposable test harness reconstructs the audited baseline in a newly generated localhost database, applies only the additive SQL, checks schema parity, runs tests and drops only that generated database. This demonstrates schema compatibility; it does not prove that production migration history matches the repository.

## Validation

Final validation results are being collected. CI and browser evidence will be linked after the consolidated pull request is created.

## Production verification blockers

The identified production Supabase project is **OpsWatch / `ndricuhmrfycqrhermul`**. The connected tool denied access to that project. The other connected project was not substituted, and no remote table was created or changed. Production topology, assignments, connection import history, worker execution and provider-call evidence therefore remain unverified.

PR 18 delivered the catalogue/proposal foundation rather than persistent assignments or a complete discovery workflow. Source inspection shows that URL-only onboarding creates public/admin endpoint monitors; those two endpoints cannot establish a complete internal topology. The actual OkangGroup failure must still be distinguished using its real import, assignment, entity and relationship records. Intermittent production AI status likewise needs timestamped configuration/runtime/log evidence; the code corrections do not establish a retrospective production root cause.

Before release acceptance, use read-only access to the correct project and application to verify NiiNai property containers/shared components/relationships, 600-second device monitoring and observe-only policy; reconcile OkangGroup and Oware World source manifests and exact graph identities; verify assignment bindings and worker/capability evidence. Existing fixture tests are compatibility evidence, not a substitute for these live checks. Production deployment and database changes require separate approval after validation.
