# Phase 9 — Learning and prediction verification

Date: 2026-07-20  
Inventory: `6613279` · Schema: `1b6a9ff`  
Programme: Phase 9 only (stop before Phase 10). No push/deploy. No native Datadog/Dynatrace.

## Gates (local)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` (api) | Pass |
| `pnpm --filter @opswatch/web/worker exec tsc --noEmit` | Pass |
| Focused learning unit tests | **17 passed** (+ 1 DB E2E skipped without flag) |
| `RUN_DATABASE_E2E=true` learning DB E2E | **1 passed** |
| Full package tests (`RUN_DATABASE_E2E=false`) | API **395** · web **142** · worker **36** |
| Lint | 0 errors (1 pre-existing web hooks warning) |
| `pnpm --filter @opswatch/web build` | Pass |
| Playwright `e2e/phase9-learning.spec.ts` | **1 passed** |

## Browser evidence

`test-artifacts/phase9-learning/` (gitignored):

01–18 screenshots captured. Honest disabled/empty states when learning stage flags are off (default). Prediction generation remains OFF.

## Privacy / isolation

- Org-scoped reads/writes; review rejects cross-org prediction IDs (DB E2E).
- Fixture/demo/seeded project names excluded from baseline calculation.
- No cross-client model training.

## Remaining limitations

- Metric baselines stay empty until `OPSWATCH_LEARNING_BASELINES_ENABLED=true` and a learning cycle runs against live non-fixture evidence.
- Not every signal family (queue depth, business events) has a dedicated writer yet.
- Outcome quality metrics stay `n/a` until ≥10 evaluated outcomes.
- Local Postgres can flap under parallel connection storms; Intelligence snapshot reads are sequential to reduce pressure.
- Native Datadog/Dynatrace connectors are out of scope until after Phase 9.
