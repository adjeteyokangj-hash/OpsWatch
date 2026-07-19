# Phase 5 product-truth verification

Date: 2026-07-19  
Baseline: `acb92e0`  
Overall result: **NOT COMPLETE — browser and database acceptance blocked**

This report records evidence without upgrading an unverified result to a pass.
Phase 6 has not started.

## Acceptance results

- **PASS — no cosmetic topology replay in code.** The client-only replay slider,
  status mutation, and replay component were removed. Current canonical
  topology is labelled `Live verified`; Operations Timeline is explicitly event
  history and says it does not reconstruct an earlier graph.
- **PASS — synthetic journeys remain drafts.** Persisted
  `SyntheticJourney` rows are surfaced as `DRAFT` with
  `executionEnabled: false`. No worker executor exists, and the UI states
  `Draft — execution not yet enabled`.
- **PASS — Logs and Security truth states.** Logs is `Foundation` and states
  there is no searchable central log store. Security is `Foundation` and
  separates platform/auth/credential controls from unavailable threat,
  vulnerability, attack-path, risk-scoring, and containment capabilities.
- **PASS — predictions disabled in code and focused tests.** The Phase 9
  environment flag is reserved and ignored, product emission is disabled, and
  the API reports zero live prediction candidates. Baselines and calculated
  patterns are explicitly not predictions.
- **PASS — report/catalogue/test-data labels in code and focused tests.**
  Reports identify calculated/preview/configuration states. Only REST/API and
  agentless URL modes are `Available` in the guided catalogue; manifest-only
  modes cannot test or start monitoring. Explicit test environment/provenance
  drives the reusable `Test data` indicator and non-test diagnostic.
- **PASS — Phase 4 topology model retained.** No schema or migration changed;
  `Service`, `ServiceDependency`, canonical entities/relationships, topology
  loader, alerts, incidents, and automation paths remain present.
- **FAIL — focused browser evidence.** The authenticated Playwright journey
  started but the local PostgreSQL service became unreachable while loading
  the selected topology. It failed before the first required screenshot, so
  `test-artifacts/phase5-product-truth/` contains no claimed evidence.
- **NOT VERIFIED — full workspace and DB suites.** Commands that depended on
  the failing local database did not return a trustworthy exit status. They are
  not counted as passed.

## Commands and exact results

1. `pnpm typecheck` — first run exit **2**, one nullable
   `DeploymentRecord.projectId` type mismatch; corrected. Second run exit
   **0**, all five participating workspace projects passed.
2. PowerShell equivalent of `NODE_ENV=test pnpm test` — **no exit status
   returned** by the command harness. A retry also returned no exit status.
   This is **not a pass**.
3. `pnpm --filter @opswatch/web test` — first run exit **1**:
   **29/30 files passed, 139/140 tests passed**; the new discovery-label test
   exposed `UNCONFIRMED` being parsed as confirmed. Corrected. Final run exit
   **0**: **30 files passed, 140 tests passed**.
4. Focused Phase 5 web Vitest command covering shared truth vocabulary,
   catalogue, topology timeline, and canvas — exit **0**:
   **4 files passed, 29 tests passed**.
5. Focused Phase 5 API Vitest command covering prediction gates — exit **0**:
   **2 files passed, 9 tests passed**.
6. `RUN_DATABASE_E2E=true` topology-unification database test — **no exit
   status returned**. Runtime logs subsequently recorded
   `Can't reach database server at localhost:5432`; result **not verified**.
7. `pnpm lint` — exit **0**. One existing React hooks warning remains at
   `apps/web/src/app/projects/[projectId]/topology/page.tsx:262`; zero errors.
8. `pnpm build` — exit **0**. Shared, client, API, worker, and web builds
   passed; Next generated **38/38** static pages. The same hooks warning was
   reported.
9. Focused Playwright:
   `RUN_BROWSER_E2E=true PLAYWRIGHT_SKIP_WEB_SERVER=true pnpm --filter
   @opswatch/web exec playwright test e2e/phase5-product-truth.spec.ts
   --project=chromium --reporter=list` — exit **1**, **1 failed** after 4.1
   minutes. `page.goto` timed out loading
   `/projects/<local-project>/topology`; API runtime logs show PostgreSQL became
   unreachable. Failure evidence:
   `test-artifacts/playwright-output/phase5-product-truth-Phase-30e65-tates-and-captures-evidence-chromium/`.

## Browser evidence status

Required targets are encoded in
`apps/web/e2e/phase5-product-truth.spec.ts`: topology live/timeline, synthetic
Draft, Logs Foundation, Security Foundation, predictions disabled, catalogue
statuses, test-data indicator, and report evidence/unavailable state.

No screenshots under `test-artifacts/phase5-product-truth/` are claimed because
the local database failure occurred before capture. The Playwright failure
screenshot, trace, and error context above are diagnostic evidence only.

## Database, migrations, and security

- No Prisma schema or migration changed.
- The browser journey created one local application explicitly marked
  `environment: test` and attempted deletion in `finally`. Because PostgreSQL
  became unreachable, deletion could not be independently confirmed. This is a
  local test-data effect, not production.
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
- Browser acceptance and relevant DB acceptance must be rerun after restoring
  local PostgreSQL. Until then Phase 5 must not be marked complete.

## Local commits

1. `1e838e6` — Phase 5 truth inventory
2. `ba6b07f` — topology replay/timeline correction
3. `2ea8e99` — synthetic journey correction
4. `b6dd424` — Logs/Security/Intelligence truth states
5. `2ed5121` — reports/catalogue/test-data corrections
6. Verification tests and this report — the sixth local commit containing this
   file (exact SHA recorded in the final handoff)

Nothing was pushed or deployed. Production was not modified.
