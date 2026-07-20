# Phase 7 remediation verification notes

Date: 2026-07-19 / 2026-07-20  
Baseline start: `7f49aa4f9f1b0519e7466f0664683e2475b4c46e`  
Follow-up closed acceptance gaps after foundation commit `66fc38b`.

## Honest status

**§26 acceptance: largely met for local proofs and gates in this session.**  
Do not treat Datadog/Dynatrace or Phase 8 as started. Nothing was pushed or deployed.

Browser lifecycle screenshots 01–10 / 12 document Automation workspace **filter chrome**; matching live run rows may be empty in the smoke org. Real governed proofs are covered by `phase7-governed.database-e2e.test.ts` (4/4) plus hardening (2/2).

## Migrations applied locally

- `20260719230000_phase7_remediation_governance` — tables verified: `RemediationApproval`, `RemediationExecutionRun`, `RemediationCircuitBreaker`
- `20260719233000_phase7_maintenance_remediation_policy` — `MaintenanceWindow.remediationPolicy`

## Commands run (sequential §25)

```powershell
pnpm typecheck
# PASS (EXIT 0)

Remove-Item Env:RUN_DATABASE_E2E -ErrorAction SilentlyContinue
$env:NODE_ENV='test'; pnpm test
# PASS — api 369 passed | 30 skipped; web 142 passed; worker 36 passed | 3 skipped

$env:NODE_ENV='test'; pnpm --filter @opswatch/api exec vitest run src/services/remediation src/services/maintenance-remediation-policy.service.test.ts src/services/alert-automation-evaluation.service.test.ts
# PASS — 52 passed | 6 skipped (DB E2E skipped without flag)

$env:RUN_DATABASE_E2E='true'; pnpm --filter @opswatch/api exec vitest run src/services/remediation/phase7-governed.database-e2e.test.ts src/services/remediation/remediation-hardening.database-e2e.test.ts --fileParallelism=false
# PASS — 6 passed (4 governed + 2 hardening)
Remove-Item Env:RUN_DATABASE_E2E -ErrorAction SilentlyContinue

pnpm lint
# PASS (1 pre-existing react-hooks warning on topology page)

pnpm build
# PASS

# stack: scripts/start-local-smoke-stack.ps1 -SkipBuild
$env:RUN_BROWSER_E2E='true'; pnpm --filter @opswatch/web exec playwright test e2e/phase7-remediation.spec.ts
# PASS — 1 passed; 18 PNGs under test-artifacts/phase7-remediation/
```

Gate log copies: `test-artifacts/phase7-remediation/gate-*.txt` (gitignored).

## Evidence directory

`test-artifacts/phase7-remediation/`

| Shot | File | Notes |
|------|------|-------|
| 01 | `01-observe-recommendation.png` | Automation filter chrome (PROPOSED) |
| 02 | `02-approval-request.png` | Pending approvals panel |
| 03 | `03-approval-granted.png` | Filter APPROVED |
| 04 | `04-action-running.png` | Filter EXECUTING |
| 05 | `05-verification-running.png` | Filter VERIFYING |
| 06 | `06-recovery-verified.png` | Filter VERIFIED_HEALTHY |
| 07 | `07-verification-failed.png` | Filter VERIFICATION_FAILED |
| 08 | `08-rollback-running.png` | Filter ROLLING_BACK |
| 09 | `09-rollback-complete.png` | Filter ROLLED_BACK |
| 10 | `10-autonomous-low-risk.png` | Filter EXECUTED |
| 11 | `11-setup-required.png` | Maintenance remediation policy UI |
| 12 | `12-blocked-circuit-breaker.png` | Filter BLOCKED |
| 13 | `13-alert-automation-panel.png` | Alert detail |
| 14 | `14-incident-remediation-timeline.png` | Incident remediation timeline |
| 15 | `15-relationship-fix-action.png` | Topology |
| 16 | `16-automation-workspace.png` | Automation Centre |
| 17 | `17-mobile-approval.png` | Mobile viewport |
| 18 | `18-mobile-run-status.png` | Mobile viewport |

## Local proofs (DB E2E — real test connectors)

1. **Autonomous low-risk:** `RERUN_HTTP_CHECK` against local health server  
2. **Connection:** `TEST_CONNECTION` agentless probe (`OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES`)  
3. **Approval:** `RESTART_WORKER` via local remediator webhook after approve  
4. **Failed verify + rollback:** `REVIEW_HTTP_EXPECTED_STATUS` against unreachable URL  

No Noble Express production-like destructive data.

## Remaining limitations

- Browser status shots are not guaranteed to show populated run rows for each lifecycle state in the smoke login org.  
- Transient local Postgres flaps can 500 the Automation workspace until the stack is restarted.  
- Payment retry remains disabled in the universal registry by design.  
- Phase 8 / native Datadog / Dynatrace not started.
