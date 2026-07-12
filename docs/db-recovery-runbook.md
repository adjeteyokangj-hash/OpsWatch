# OpsWatch database recovery runbook

## Purpose

Provide a repeatable backup and restore procedure for controlled production rollout. This runbook prefers **application rollback** first and uses **database restore** only when data or schema integrity requires it.

## Responsible operator

Platform / on-call administrator with PostgreSQL access and deployment credentials.

## Estimated recovery time

| Scenario | Estimated RTO |
|----------|----------------|
| Application-only rollback | 5–15 minutes |
| Database restore from latest verified backup | 15–30 minutes |
| Forward-fix migration after partial deploy | 10–45 minutes depending on migration complexity |

## Before rollout

1. Run `pnpm gate:backup-drill` and confirm `BACKUP_DRILL_PASS`.
2. Store the generated backup under `tmp/db-backups/` in secure off-host storage for production.
3. Record migration state from the generated `migration-state-*.txt` file.

## Backup command (manual)

```powershell
pnpm gate:backup-drill
```

This script:

1. Creates a plain SQL backup with `pg_dump`
2. Records current Prisma migration status
3. Restores into an isolated database named `<source>_recovery_gate`
4. Validates representative counts for projects, services, alerts, incidents, automation, maintenance, and billing

## Restore procedure (when required)

1. **Stop traffic** to API and worker (keep web in maintenance mode if needed).
2. **Rollback application** to the previous known-good deployment if the issue is code-only.
3. If database integrity is affected:
   - Terminate active connections to the target database
   - Restore from the latest verified backup file
   - Run `cd apps/api && npx prisma migrate status` and confirm schema matches expectation
4. **Do not reset migration history**. Only apply additive forward migrations after restore.
5. Restart API, worker, and web.
6. Run:
   - `pnpm gate:validate-env`
   - `pnpm gate:verify-self-monitoring`
   - Representative login and incident/alerts smoke checks

## Rollback preference order

1. Application rollback to previous deployment artifact
2. Forward-fix additive migration when safe
3. Database restore from verified backup when data integrity requires it

## Evidence retention

Keep for each drill:

- Backup filename and size
- Migration state capture
- Recovery validation counts
- Operator name and timestamp
