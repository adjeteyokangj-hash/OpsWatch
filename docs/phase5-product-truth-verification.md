# Phase 5 product-truth verification

Date: 2026-07-19  
Baseline: `acb92e0`  
Re-verification after PostgreSQL restore: same day (local only)  
Overall result: **COMPLETE — acceptance gates passed with recorded evidence**

This report records evidence. Phase 6 has not started.
Nothing was pushed or deployed. Production was not modified.

## Acceptance results

- **PASS — no cosmetic topology replay in code.** The client-only replay slider,
  status mutation, and replay component were removed. Current canonical
  topology is labelled `Live verified`; Operations Timeline is explicitly event
  history and says it does not reconstruct an earlier graph.
- **PASS — synthetic journeys remain drafts.** Persisted
  `SyntheticJourney` rows are surfaced as `DRAFT` with
  `executionEnabled: false`. No worker executor exists, and the UI states
  `Draft — execution not yet enabled` / not active monitoring.
- **PASS — Logs and Security truth states.** Logs is `Foundation` and states
  there is no searchable central log store. Security is `Foundation` and
  separates platform/auth/credential controls from unavailable threat,
  vulnerability, attack-path, risk-scoring, and containment capabilities.
- **PASS — predictions disabled in code and focused tests.** The Phase 9
  environment flag is reserved and ignored for product emission, and the API
  reports zero live prediction candidates. Baselines and calculated
  patterns are explicitly not predictions.
- **PASS — report/catalogue/test-data labels in code and focused tests.**
  Reports identify calculated/preview/configuration states. Only REST/API and
  agentless URL modes are `Available` in the guided catalogue; manifest-only
  modes cannot test or start monitoring. Explicit test environment/provenance
  drives the reusable `Test data` indicator and non-test diagnostic.
- **PASS — Phase 4 topology model retained.** No schema or migration changed;
  `Service`, `ServiceDependency`, canonical entities/relationships, topology
  loader, alerts, incidents, and automation paths remain present.
- **PASS — focused browser evidence.** Authenticated Playwright journey
  completed after local PostgreSQL was restored. Screenshots were written under
  `test-artifacts/phase5-product-truth/` (gitignored; paths recorded below).
- **PASS — relevant DB acceptance for Phase 5 topology gate.**
  `topology-unification.database-e2e.test.ts` with `RUN_DATABASE_E2E=true`
  passed **1/1**.
- **FAIL (non-blocking for Phase 5 product-truth gate) — legacy
  `topology.database-e2e.test.ts`.** With only legacy `Service` /
  `ServiceDependency` rows and no canonical backfill step, `loadProjectTopology`
  returned **0** nodes (expected 3). Canonical unification coverage is provided
  by the unification E2E above. Recorded here so it is not silently ignored.

## Commands and exact results

PowerShell-compatible env syntax used throughout.

### Database connectivity

1. Windows service `postgresql-x64-18` — **Running**; TCP listen on `5432`.
2. `DATABASE_URL` from `apps/api/.env` —
   `postgresql://postgres:***@localhost:5432/opswatch?schema=public` (redacted).
3. Prisma execute from `apps/api` (PowerShell pipe, no bash heredoc):

```powershell
$dbUrl = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', '' -replace '^"|"$', ''
$env:DATABASE_URL = $dbUrl
"SELECT 1 AS ok;" | npx --yes prisma db execute --stdin --schema prisma/schema.prisma
```

   Exit **0** — `Script executed successfully.`
4. Connection sample via Prisma client — activity **11** then later **29** /
   `max_connections` **100**; database `opswatch` on `::1`.

### Prior gates (unchanged from earlier Phase 5 work; still counted)

1. `pnpm typecheck` — exit **0** (after nullable `DeploymentRecord.projectId` fix).
2. `pnpm --filter @opswatch/web test` — exit **0**: **30 files / 140 tests**.
3. Focused Phase 5 web Vitest (truth vocabulary, catalogue, topology timeline,
   canvas) — exit **0**: **4 files / 29 tests**.
4. Focused Phase 5 API Vitest (prediction gates) — exit **0**: **2 files / 9 tests**.
5. `pnpm lint` — exit **0** (existing hooks warning on topology page remains;
   zero errors).
6. `pnpm build` — exit **0** (38/38 Next static pages).

### Re-run after PostgreSQL restore

7. Topology unification DB E2E:

```powershell
$env:RUN_DATABASE_E2E='true'
pnpm --filter @opswatch/api test -- src/services/topology-unification.database-e2e.test.ts
```

   Exit **0** — **1 file passed, 1 test passed**.

8. Combined topology DB pair (diagnostic):

```powershell
$env:RUN_DATABASE_E2E='true'
pnpm --filter @opswatch/api exec vitest run src/services/topology-unification.database-e2e.test.ts src/services/topology.database-e2e.test.ts --reporter=verbose
```

   Exit **1** — unification **passed**;
   `topology.database-e2e.test.ts` **failed** (`nodes` length 0 vs 3).

9. Local smoke stack for browser evidence:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local-smoke-stack.ps1 -SkipBuild
```

   First attempt failed: web `.next` lacked `BUILD_ID`. After
   `pnpm --filter @opswatch/web build` (exit **0**) and stack restart,
   `pnpm exec tsx scripts/wait-local-stack.ts` → **STACK_READY**, exit **0**.
   `pnpm exec tsx scripts/ensure-smoke-fixtures.ts` → exit **0**.

10. Focused Playwright (final successful run):

```powershell
$env:RUN_BROWSER_E2E='true'
$env:PLAYWRIGHT_SKIP_WEB_SERVER='true'
pnpm --filter @opswatch/web exec playwright test e2e/phase5-product-truth.spec.ts --project=chromium --reporter=list
```

    Exit **0** — **1 passed** (≈ 3.1 minutes).  
    Harness note: expect timeout raised to **90s** in the Phase 5 spec because
    local `GET /api/insights/product` observed **~18–51s** responses; default
    10s expect budget was insufficient (not a product-truth claim failure).

### Earlier blocked run (superseded)

- Prior Playwright exit **1** when PostgreSQL became unreachable mid-request
  (`P1001` / `Can't reach database server at localhost:5432`) while the topology
  page showed `Loading service map…`. That run produced no claimed evidence
  directory. Superseded by the exit **0** run above after service restore and
  stack rebuild.

## Browser evidence

Required targets from `apps/web/e2e/phase5-product-truth.spec.ts`. Directory is
gitignored (`test-artifacts/`); files exist on disk for local review:

| Evidence file | Captures |
| --- | --- |
| `test-artifacts/phase5-product-truth/topology-live-timeline.png` | Live verified topology; historical replay unavailable; live event history timeline; no replay slider |
| `test-artifacts/phase5-product-truth/synthetic-draft.png` | Synthetic draft / not active monitoring truth |
| `test-artifacts/phase5-product-truth/logs-foundation.png` | Logs Foundation; no searchable central store |
| `test-artifacts/phase5-product-truth/test-data-indicator.png` | Explicit `Test data` indicator on test-environment project |
| `test-artifacts/phase5-product-truth/security-foundation.png` | Security Foundation vs unavailable threat coverage |
| `test-artifacts/phase5-product-truth/predictions-disabled.png` | Predictions feature disabled; 0 live candidates |
| `test-artifacts/phase5-product-truth/connection-catalogue-statuses.png` | Catalogue Available / Planned method statuses |
| `test-artifacts/phase5-product-truth/reports-evidence-state.png` | Remediation accuracy / reports evidence surface (honest empty candidate sections) |

## Database, migrations, and security

- No Prisma schema or migration changed for this re-verification.
- Playwright creates a project with `environment: test` and deletes it in
  `finally` on the successful run.
- Managed credential handling, write-only secrets, auth/session controls,
  signed-ingest replay protection, and automation policy gates were not
  weakened.
- No production system was contacted or modified.

## Limitations and deferred capability

- Historical topology replay remains unavailable; event history is not graph
  reconstruction.
- Synthetic execution, screenshots, run history, and alert/recovery lifecycle
  remain unavailable.
- Searchable logs/APM remain Phase 6.
- Additional remediation providers remain Phase 7.
- Threat detection and containment remain Phase 8.
- Learning and prediction remain Phase 9.
- Cloud/database/custom/synthetic connector contracts are not available
  runtime connectors.
- Local `GET /api/insights/product` can take tens of seconds under this dataset;
  browser expects for that surface need a long timeout.
- Transient local PostgreSQL unreachability (`P1001`) was observed earlier in
  the day even while the Windows service reported Running; keep the service
  healthy before re-running browser/DB gates.
- Legacy `topology.database-e2e.test.ts` still fails without canonical backfill;
  fix or retire that suite separately from Phase 5 product-truth completion.

## Local commits

1. `1e838e6` — Phase 5 truth inventory
2. `ba6b07f` — topology replay/timeline correction
3. `2ea8e99` — synthetic journey correction
4. `b6dd424` — Logs/Security/Intelligence truth states
5. `2ed5121` — reports/catalogue/test-data corrections
6. `faabd7d` — verification tests and initial blocked report
7. *(this commit)* — Playwright wait/harness fix + updated verification record
   after DB restore and successful browser evidence

Nothing was pushed or deployed. Production was not modified.
