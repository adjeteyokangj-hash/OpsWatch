# Correlation and SLO staging validation

This release is additive. Do not reset or edit migration history.

## Deployment

1. Back up staging and record the current migration with `prisma migrate status`.
2. Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, then `pnpm db:migrate`.
3. Confirm existing project, service, check and result counts match the pre-deploy counts.
4. Create a dependency and SLO through the dashboard; confirm both short and objective-window rows are written after the worker evaluation.
5. Restart the worker and verify correlation and SLO jobs read the new schema without errors.

## Forward-only rollback

If application rollback is required, stop the new worker first and redeploy the previous API/web/worker release. The added nullable/defaulted columns may remain in place and are ignored by the previous release. Do not drop columns during an incident. Remove them only in a separately reviewed migration after confirming no SLO definitions rely on scope, window type or archive state.

## Evidence to retain

- Migration status before and after deployment.
- Row counts before and after deployment.
- IDs of the staging dependency, SLO definition and its short/long windows.
- Worker log lines for correlation and SLO evaluation.
- The release SHA and rollback decision owner.
