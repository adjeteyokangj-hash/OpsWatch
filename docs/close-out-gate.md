# OpsWatch close-out gate (B1–B5 + health restructure)

## Prisma client refresh (fixes Projects 500)

```powershell
# Stop pnpm dev (Ctrl+C). If EPERM on generate:
taskkill /F /IM node.exe
cd apps/api
npx prisma migrate deploy
npx prisma generate
cd ../..
pnpm dev
```

**Verified 2026-07-11:** After `prisma generate`, `GET /api/projects` returns 200 (no `Value 'UNKNOWN' not found in enum 'ProjectStatus'`).

## Flaky test tracker

See [flaky-test-tracker.md](./flaky-test-tracker.md) — both previously failing DB E2E tests are fixed.

## Automated checks

```powershell
# 1. Fresh migration
cd apps/api
npx prisma migrate deploy

# 2. Prisma generate (stop API process first on Windows if EPERM)
npx prisma generate

# 3. Seed + billing backfill (deployment only — not on GET /projects)
pnpm --filter @opswatch/api exec tsx prisma/seed.ts
pnpm --filter @opswatch/api exec tsx scripts/backfill-project-billing.ts

# 4–6. Test suites
pnpm --filter @opswatch/api test
$env:RUN_DATABASE_E2E='true'; pnpm --filter @opswatch/api test
pnpm --filter @opswatch/worker test
pnpm --filter @opswatch/web test

# 7. Browser E2E (dev stack running; install browsers once)
pnpm --filter @opswatch/web exec playwright install chromium
$env:RUN_BROWSER_E2E='true'; pnpm --filter @opswatch/web test:e2e:automation

# 8. Production build
pnpm build
```

## Last verified (2026-07-11 — production gate)

| Suite | Result |
|-------|--------|
| API unit + DB E2E | **70 / 70** |
| Worker | **18 / 18** |
| Web unit | **10 / 10** |
| Full workspace build (`pnpm build`) | **pass** |
| Maintenance smoke E2E | **pass** |
| Security remediations | **pass** (8/8) |
| Migrations | **26 applied, up to date** |

Worker `rootDir` fix applied (`apps/worker/tsconfig.json`); shared package excludes `*.test.ts` from build emit.

## Production-readiness gate

Do not begin another large feature phase until all are complete:

- [x] Full build passes (`pnpm build`)
- [x] Browser E2E passes (`RUN_BROWSER_E2E=true pnpm --filter @opswatch/web test:e2e:automation`; skips when no incidents in DB)
- [x] Maintenance smoke passes (automated E2E — `maintenance.database-e2e.test.ts`)
- [x] RECOVERING lifecycle wired (`project-recovery-lifecycle.service.ts` + automation executor)
- [x] Billing backfill moved to migration `20260711130000_backfill_project_billing` + `scripts/backfill-project-billing.ts` (GET /projects is read-only)
- [x] Security review completed (2026-07-11 — see findings below)
- [x] Security findings remediated (see [production-gate-report.md](./production-gate-report.md))
- [x] Production environment variables validated (target deploy — `pnpm gate:validate-env`, 0 failures)
- [x] Worker schedules confirmed (see `apps/worker/src/services/scheduler.service.ts`)
- [x] Database backup and rollback process tested (`pnpm gate:backup-drill` — `BACKUP_DRILL_PASS`)
- [x] Monitoring of OpsWatch itself enabled (`pnpm monitoring:setup-self` + `pnpm gate:verify-self-monitoring`)
- [x] Close-out documentation updated

### Prisma client after enum migrations

If `/projects` returns 500 with `Value 'UNKNOWN' not found in enum 'ProjectStatus'`, stop **all** Node processes (API **and** worker hold the engine DLL on Windows) and run:

```powershell
taskkill /F /IM node.exe
cd apps/api
npx prisma migrate deploy
npx prisma generate
cd ../..
pnpm dev
```

**Verified 2026-07-11:** After regenerate + restart, worker heartbeat job runs with no `UNKNOWN` enum errors.

If web `/login` returns 500 after `pnpm build`, delete `apps/web/.next` and restart `pnpm dev`.

### Security review findings (2026-07-11)

| Severity | Location | Finding |
|----------|----------|---------|
| High | `review-http-expected-status.executor.ts` | Cross-tenant check mutation — load check with org scope |
| High | `projects.controller.ts` create | Billing/plan fields writable by any org member on create |
| High | `playbook-governance.service.ts` | Global playbook catalog approvable by per-org admin |
| Medium | `project-billing.controller.ts` GET | `internalNotes` exposed to all org members |
| Medium | `maintenance-windows.service.ts` update | `serviceIds` not re-validated on PATCH |
| Medium | `worker-internal.ts` | Internal routes fail-open when secret unset in development |
| Medium | `seed.ts` | Default admin password in repository |
| Medium | `incidents.controller.ts` change-events | Writable without role gate — **fixed:** requires `remediation:execute:safe` |

All eight findings remediated 2026-07-11. Details in [production-gate-report.md](./production-gate-report.md).

Recommended fix order: ~~HTTP review executor org scope → billing on create + redact notes → tenant-scope playbooks → maintenance PATCH validation → worker-internal hardening → change-event permission~~ **Complete.**

### Maintenance smoke

1. Create maintenance window at `/settings/maintenance` with suppress alerts + suppress incidents, `allowAutonomous=false`
2. Trigger health signal (HTTP check fail or heartbeat stale)
3. Confirm alert stored with `maintenanceSuppressed` (resolved, not notified)
4. Confirm no new incident when `suppressIncidents` is on
5. Attempt autonomous remediation — should block with maintenance reason
6. Cancel or wait for window to complete
7. Confirm normal alerting and correlation resume

## Manual smoke: StarLiz UNKNOWN health

1. Create project with no completed checks
2. Overview shows **Awaiting first check**, not DEGRADED
3. Projects table Reason: `No completed monitoring result`
4. Billing tab shows project-scoped plan (independent from other projects)
