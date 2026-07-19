# Phase 7 remediation verification notes

Date: 2026-07-19  
Baseline start: `7f49aa4f9f1b0519e7466f0664683e2475b4c46e`

## Commands (sequential)

```powershell
pnpm typecheck
$env:NODE_ENV='test'; pnpm test
# focused
pnpm --filter @opswatch/api exec vitest run src/services/remediation src/services/alert-automation-evaluation.service.test.ts
$env:RUN_DATABASE_E2E='true'; pnpm --filter @opswatch/api exec vitest run src/services/remediation --reporter=verbose
pnpm lint
pnpm build
# focused Playwright (when stack up)
pnpm --filter @opswatch/web exec playwright test e2e --grep remediation
```

## Evidence directory

`test-artifacts/phase7-remediation/`

Capture screenshots 01–18 when browser stack is available:

01-observe-recommendation  
02-approval-request  
03-approval-granted  
04-action-running  
05-verification-running  
06-recovery-verified  
07-verification-failed  
08-rollback-running  
09-rollback-complete  
10-autonomous-low-risk  
11-setup-required  
12-blocked-circuit-breaker  
13-alert-automation-panel  
14-incident-remediation-timeline  
15-relationship-fix-action  
16-automation-workspace  
17-mobile-approval  
18-mobile-run-status  

## Local proofs expected

1. Worker: remediator `restart_sync_worker` (Approval)  
2. Integration/check: `RERUN_HTTP_CHECK` or webhook retry (Autonomous low-risk when opted in)  
3. Connection: `TEST_CONNECTION` / `REENABLE_CONNECTION`  
4. Failed verification or rollback via `REVIEW_HTTP_EXPECTED_STATUS` or governed verify path  

Use test apps/connectors only. Do not run destructive Noble Express production-like tests.
