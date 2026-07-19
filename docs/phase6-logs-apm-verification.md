# Phase 6 Logs/APM — verification close-out

Date: 2026-07-19  
Start baseline: `59c8d2f0d964ed2ee18ed49791773b280a8bc0d0`  
Nothing pushed or deployed.

## 1. Migration

- Applied: `20260719200000_phase6_logs_apm_foundations`
- `prisma migrate status`: Database schema is up to date (52 migrations)
- Tables verified present: `LogRecord`, `LogOccurrenceGroup`, `TraceRecord`, `SpanRecord`, `ApmServiceWindow`, `ApmEndpointWindow`, `ApmDependencyWindow`, `LogEvidenceLink`, `SpanEvidenceLink`, `ApmEvidenceLink`
- Existing counts after migrate (intact): `NormalizedOperationalSignal=20`, `Alert=1144`, `Incident=597`
- Additive only; rollback limitations: `docs/phase6-migration-rollback.md`

## 2. Static / test gates (sequential)

| Gate | Result | Notes |
| --- | --- | --- |
| `pnpm typecheck` | exit **0** | shared, client, api, worker, web |
| `NODE_ENV=test pnpm test` (no `RUN_DATABASE_E2E`) | exit **0** | see package counts below |
| Focused unit `logs-apm.unit.test.ts` | exit **0** | **8 passed** |
| `RUN_DATABASE_E2E=true` `logs-apm.database-e2e.test.ts` | exit **0** | **5 passed** |
| `pnpm lint` | exit **0** | 1 pre-existing warning in topology page |
| `pnpm build` | exit **0** | api/worker/web/packages |

### Package-by-package test counts (`NODE_ENV=test pnpm test`)

| Package | Files | Tests |
| --- | --- | --- |
| `@opswatch/api` | 73 passed, 13 skipped | 348 passed, 26 skipped |
| `@opswatch/web` | 30 passed | 140 passed |
| `@opswatch/worker` | 11 passed, 3 skipped | 36 passed, 3 skipped |
| **Totals** | **114 passed, 16 skipped** | **524 passed, 29 skipped** |

## 3. Database E2E

Covered: redaction, grouping, no alert storm, partial/late/duplicate spans, APM windows, topology health update, alert + incident evidence links, org/env isolation, healthy vs stale Unknown, retention prune preserves incident evidence.

## 4–11. Runtime / UI / Playwright

- Local flags enabled in `apps/api/.env` only (gitignored): Logs/APM + OTEL alert/incident/topology discovery + canonical read
- `.env.example` production defaults remain **false**
- Playwright: `apps/web/e2e/phase6-logs-apm.spec.ts` — **1 passed**, exit **0**
- Screenshots under `test-artifacts/phase6-logs-apm/` (01–15)

## Defects fixed during verification

1. Expanded DB E2E assertions; fixed Incident create (`updatedAt` invalid) and window prune cutoff.
2. Wired `LogEvidenceLink` / `SpanEvidenceLink` / `ApmEvidenceLink` into alert + incident API + UI.
3. Playwright: correct `assertPageReady` args; failure artifact label string.

## Remaining honest limitations

- Playwright captures Foundation/empty/list states for a fresh TEST-ONLY project; dense live log/APM rows require a prior ingest journey into that project.
- APM percentiles remain approximate running estimates.
- `OtelMetricWindow` still unused (Phase 6 uses `Apm*Window`).
