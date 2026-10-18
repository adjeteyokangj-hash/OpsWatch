# Topology release

This note is the local release procedure for the topology manifest column and the NiiNai structure import. It does not authorise a deployment.

## Database

The only schema change is a nullable column:

`Service.topologyMetaJson JSONB`

Migration: `apps/api/prisma/migrations/20261018120000_service_topology_meta/migration.sql`

It has been applied to the local `opswatch` database on localhost. It has not been applied to production.

Production apply, only after explicit approval:

1. Confirm `DATABASE_URL` is the intended production database.
2. Take a backup or confirm the host's point-in-time recovery window.
3. Run the OpsWatch migration guard with `OPSWATCH_DB_MIGRATION_APPROVAL` set for that command only.
4. Apply this migration and no unrelated pending migrations.
5. Confirm the column exists and existing `Service` rows are unchanged (`topologyMetaJson` is null).

Rollback: `ALTER TABLE "Service" DROP COLUMN IF EXISTS "topologyMetaJson";`

Dropping the column removes declared kinds and health bindings from stored services. The services and dependency rows remain. Re-importing the manifest restores the metadata.

## Application deploy

Do not deploy until:

- The column exists in the target database. A topology read selects it, so a deploy before the migration fails that query.
- The hosted `opswatch-topology` function is still absent or deliberately published. On 18 October 2026 the gateway returned `404 Requested function was not found` for `GET /functions/v1/opswatch-topology` with no API key. Publishing it is a separate approval.
- A connection to that function has not been activated. Discovery sends only the configured bearer. It does not send a Supabase anon or service-role key.

Deploy order after approval: migration, then API and worker, then web. The worker refresh imports any active API connection that has a discovery path. Leave the NiiNai topology connection inactive until the function is published and a bearer-only request is shown to succeed.

Rollback order: redeploy the previous API, worker, and web. The new column can stay; older code does not read it. If the manifest import created services that should not remain, deactivate the discovered dependency rows rather than deleting monitored services.

## What stays grey

Components without a health binding, including Supabase authentication, Supabase data, payments, refunds, End of Day, and cash reconciliation, stay unknown. A failed financial synchronisation lane does not mark those components failed.
