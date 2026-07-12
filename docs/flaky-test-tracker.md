# Flaky / failing API database E2E tests

Tracked failures from the B3–B5 close-out gate (`pnpm --filter @opswatch/api test`).

| Test | File | Status |
|------|------|--------|
| HTTP approval rollback | `automation-http-approval.database-e2e.test.ts` | **Fixed** — context now derives `newExpectedStatusCode` from `rawJson.actualStatusCode`; rollback detection checks `details.rolledBack` |
| Redis cascade correlation | `automation-redis-playbook.database-e2e.test.ts` | **Fixed** — correlation timeline writes skip deleted incidents (FK race under parallel DB E2E) |

## HTTP approval rollback

- **Test:** `executes approved plan through remediation pipeline with rollback on failed verification`
- **Error (before fix):** `expected 'FAILED' to be 'ROLLED_BACK'` on `REVIEW_HTTP_EXPECTED_STATUS` step
- **Root cause:** `buildRemediationContext` did not populate `newExpectedStatusCode` when the latest FAIL result stored the actual code only in `rawJson`; review step failed before rollback path
- **Fix:** `automation-run-executor.service.ts` — derive status code from `rawJson.actualStatusCode`; treat `details.rolledBack` as rollback signal
- **Passes alone:** Yes (with `RUN_DATABASE_E2E=true`)
- **Owner:** Platform / Automation — resolved in-repo

## Redis cascade correlation

- **Test:** `automation redis cascade playbook` (`beforeAll`)
- **Error (before fix):** `Foreign key constraint violated: IncidentTimelineEvent_incidentId_fkey`
- **Root cause:** `runIncidentCorrelationJob` processes all open incidents globally; parallel DB E2E suites can delete incidents between `findMany` and timeline `create`
- **Fix:** `run-incident-correlation.job.ts` — verify incident exists; catch FK errors and skip with warning
- **Passes alone:** Yes
- **Owner:** Platform / Correlation — resolved in-repo

## Re-run gate

```powershell
cd apps/api
npx prisma migrate deploy
npx prisma generate   # stop API process first if EPERM on Windows
pnpm test
$env:RUN_DATABASE_E2E='true'; pnpm test
```
