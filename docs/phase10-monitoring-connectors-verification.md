# Phase 10 — Monitoring source connectors verification

Verification date: 2026-07-20
Base: Phase 9 accepted at `9ad0f77`
Foundation commits: `6c22286`, `88be0e2`
Nothing pushed or deployed.

## Migration applied

- `pnpm --filter @opswatch/api db:generate` → exit 0
- `prisma migrate deploy` → exit 0
- Applied: `20260720143000_phase10_monitoring_connectors`

## Commands and exit codes

| Gate | Result |
|---|---|
| API / web / worker typecheck | exit 0 |
| API unit tests (`RUN_DATABASE_E2E=false`) | 405 passed, 37 skipped, exit 0 |
| Phase 10 connector units | 10 passed, exit 0 |
| Phase 10 DB E2E | 5 passed, exit 0 |
| Worker tests | 39 passed, exit 0 |
| Web tests | 142 passed, exit 0 |
| Smoke stack build + READY | exit 0 |
| Playwright `e2e/phase10-monitoring.spec.ts` | 1 passed, exit 0 |

## Database E2E evidence

Fixture HTTP monitoring source exercised: validation, pagination, 429 backoff, wire normalization, canonical graph import, alert dedupe, manual sync, failed sync audit (`MonitoringSyncRun`), scheduled sync, org isolation.

## Playwright evidence

Directory: `test-artifacts/phase10-monitoring/`

- `01-registry-before.png`
- `02-wizard-details.png`
- `03-wizard-configuration.png`
- `04-connection-test.png`
- `05-registry-after-save.png`
- `06-manual-sync-success.png`
- `07-manual-sync-failed.png`
- `08-imported-topology-signals.png`
- `branding-check.txt`

## Provider-neutral branding confirmation

Customer-facing labels only (Connect monitoring source; Metrics & alerts / Application performance / Infrastructure monitoring connectors). Vendor host strings exist only under `apps/api/src/services/monitoring-connectors/private/wire-*.adapter.ts`.

## Remediation bridge

`proposeMonitoringRemediation` never auto-executes from an external alert alone; requires OpsWatch diagnosis and forces approval.

## Known limitations

- Deep log/trace import depends on source permissions.
- Sync stops after 50 pages per run.
- Uncommon wire payloads fall back to the generic JSON contract.
- Playwright captures wizard UI then creates/syncs via API against the same fixture to avoid port/mode drift.

## Final Phase 10 verdict

**Phase 10 is locally complete and accepted.** Local only — do not push until consolidated readiness audit review and explicit approval.
