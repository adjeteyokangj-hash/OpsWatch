# Recovery closure flow — local verification

## Scope delivered

Post-repair state propagation through `Check.recoveryThreshold` (default **2** consecutive PASS results) into `applyVerifiedRecoveryResolution`, with UI recovery states and Topology deep-links.

## API paths wired

| Trigger | Behaviour |
|---|---|
| `RERUN_HTTP_CHECK` / `RERUN_SSL_CHECK` | Writes `CheckResult`, then `propagateCheckRecovery` |
| Phase 7 `governed-execute` | Uses check-id path when available; otherwise verified resolution |
| Remediator `COMPLETED` | Requires post-repair verify **and** check threshold before alert close |
| Worker HTTP/SSL check jobs | On threshold met → `propagateCheckRecovery` |
| `resolve-incidents.job` | Safety net when all linked alerts are resolved |

## Operator-facing states

- Repair completed — verification pending
- Verification N of M passed
- Recovery verified / incident automatically resolved
- Partial recovery — N of M alerts resolved
- Verification failed — incident remains open

## UI

- Incident page: recovery banner, Completed + Run again, configure-setup deep links, Topology CTAs
- Remediation logs hydrated on load so Completed state survives refresh
- Topology: `?entityId=` / `?incidentId=` selection; node drawer Recovery row; open alerts keep health off Healthy

## Automated tests (local)

```bash
pnpm --filter @opswatch/api exec vitest run src/services/remediation/check-recovery-propagation.service.test.ts
pnpm --filter @opswatch/web exec vitest run src/lib/recovery-navigation.test.ts "src/app/incidents/[incidentId]/page.test.tsx" src/components/topology/topology-node-drawer.test.tsx
pnpm --filter @opswatch/worker exec vitest run src/jobs/resolve-incidents.job.test.ts
```

## Runtime / Playwright evidence

Capture under `test-artifacts/recovery-closure/` when the local stack is up:

1. Verification 1 of 2 after first successful check rerun (alert still Open)
2. Alert auto-resolves after second consecutive PASS
3. Partial incident recovery with two linked alerts
4. Full incident auto-resolve when both alerts clear
5. Topology highlights affected `entityId` with Recovering/Verifying

Do not mark accepted until those screenshots/logs exist.