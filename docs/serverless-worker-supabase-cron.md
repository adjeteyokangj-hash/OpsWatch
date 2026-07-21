# Serverless worker (Supabase Cron → Vercel)

OpsWatch's background work has historically run in a **permanent Node process**
(`pnpm dev:worker`, `apps/worker`). That process cannot be deployed to Vercel,
which runs request-scoped serverless functions with an execution deadline.

This document describes the **serverless worker mode**, in which Supabase Cron
wakes a protected Vercel endpoint every minute and that endpoint runs the *due*
subset of the worker jobs within a bounded time budget.

```text
Supabase Cron  ── every minute ──▶  POST /api/internal/worker/tick  (Vercel, protected)
                                          │
                                          ├─ acquire cross-process lease (no overlap)
                                          ├─ run only DUE jobs, within a time budget
                                          ├─ write heartbeat + per-job state to Supabase
                                          └─ return a JSON job summary
```

The continuous worker (`apps/worker`) is **not removed**. Both can run
concurrently; the same database lease prevents them from overlapping.

---

## Endpoint contract

`POST /api/internal/worker/tick`

- **Auth:** `Authorization: Bearer <OPSWATCH_CRON_SECRET>`. Missing/incorrect
  secret ⇒ `401`. If `OPSWATCH_CRON_SECRET` is unset on the server, the endpoint
  **fails closed** (every request is `401`).
- **Overlap protection:** a database lease row (`WorkerTickLock`, single key
  `serverless-worker-tick`) is claimed with an atomic conditional `UPDATE`. A
  second concurrent invocation returns immediately with `status: "SKIPPED_LOCK"`.
  We use a DB lease, **not** `pg_try_advisory_lock`, because production runs
  behind Supabase's PgBouncer transaction pooler, which does not preserve
  session-scoped advisory locks. A TTL guards against a crashed holder.
- **Due-only execution:** each job has a cadence (see below). `WorkerJobState`
  records `nextDueAt` per job; only jobs whose `nextDueAt` has passed run on a
  given tick, so long-period jobs are not executed every minute.
- **Bounded budget:** once `OPSWATCH_WORKER_TICK_BUDGET_MS` (default `50000`)
  elapses, no new jobs are started; remaining due jobs are marked `DEFERRED`
  and stay due for the next tick — well within the ~60s Supabase timeout.
- **Idempotency / retry:** a job that throws is marked failed and made
  *immediately due again*, so the next tick retries it. Jobs reuse the existing
  worker business logic (`@opswatch/worker/jobs`) and are individually
  idempotent.
- **Persistence:** one `WorkerTickRun` row per invocation records `startedAt`,
  `completedAt`, `durationMs`, `jobsAttempted/Succeeded/Failed/Deferred`,
  `heartbeatUpdated`, `heartbeatAt`, `errorSummary`, and a `summaryJson`.

### Response shape

```json
{
  "ok": true,
  "status": "COMPLETED",
  "runId": "…",
  "heartbeatUpdated": true,
  "jobsAttempted": 6,
  "jobsSucceeded": 6,
  "jobsFailed": 0,
  "jobsDeferred": 0,
  "jobsSkipped": 0,
  "durationMs": 8421,
  "skippedDueToLock": false
}
```

`status` is one of `COMPLETED` (no failures), `PARTIAL` (some succeeded/deferred
but some failed), `FAILED` (all attempted jobs failed), or `SKIPPED_LOCK`.

---

## Jobs and cadences

Cadences mirror the continuous scheduler intervals and honour the same
`WORKER_*_INTERVAL_MS` overrides (see
`apps/api/src/services/worker-tick/serverless-tick-schedule.ts`). Priority order
determines who wins the budget when time is scarce.

| Job | Default cadence | Override env |
|---|---|---|
| `processHeartbeatStaleJob` | 60s | `WORKER_HEARTBEAT_STALE_INTERVAL_MS` |
| `runHttpChecksJob` | 60s | `WORKER_HTTP_CHECK_INTERVAL_MS` |
| `processOtelBatchesJob` | 30s | `WORKER_OTEL_BATCH_INTERVAL_MS` |
| `processOtelFreshnessJob` | 60s | `WORKER_OTEL_FRESHNESS_INTERVAL_MS` |
| `runIncidentCorrelationJob` | 2m | `WORKER_INCIDENT_CORRELATION_INTERVAL_MS` |
| `resolveIncidentsJob` | 10m | `WORKER_INCIDENT_RESOLVE_INTERVAL_MS` |
| `processAlertEscalationJob` | 5m | `WORKER_ALERT_ESCALATION_INTERVAL_MS` |
| `evaluateSloBurnRateJob` | 5m | `WORKER_SLO_BURN_RATE_INTERVAL_MS` |
| `runIncidentAutoHealJob` (safe auto-heal sweep) | 3m | `WORKER_AUTO_HEAL_INTERVAL_MS` |
| `runAutomationAutonomousJob` | 5m | `WORKER_AUTOMATION_AUTONOMOUS_INTERVAL_MS` |
| `runMonitoringSyncJob` | 15m | `WORKER_MONITORING_SYNC_INTERVAL_MS` |
| `runMaintenanceWindowTransitionsJob` | 60s | `WORKER_MAINTENANCE_WINDOWS_INTERVAL_MS` |
| `runSslChecksJob` | 10m | `WORKER_SSL_CHECK_INTERVAL_MS` |
| `runExpireCredentialsJob` | 60m | `WORKER_CREDENTIAL_EXPIRY_INTERVAL_MS` |
| `runLearningCycleJob` (prediction / baseline / anomaly) | 60m | `WORKER_LEARNING_CYCLE_INTERVAL_MS` |
| `pruneRetentionJob` (retention, when due) | 6h | `WORKER_RETENTION_INTERVAL_MS` |

Recovery verification is not a standalone job — it runs inline inside the HTTP
and SSL check jobs when a check recovers.

Auto-heal / autonomous automation honour the same gates as the continuous
worker: auto-heal runs unless `WORKER_AUTO_HEAL_ENABLED=false`; autonomous
automation runs only when `WORKER_AUTOMATION_AUTONOMOUS_ENABLED=true`.

---

## Environment variables

Set on the **OpsWatch API** Vercel project (Production):

| Variable | Required | Notes |
|---|---|---|
| `OPSWATCH_CRON_SECRET` | **Yes** | Shared secret for the Bearer token. Must match Supabase Vault. |
| `DATABASE_URL` | **Yes** | Production Supabase connection (pooler `:6543` recommended). |
| `OPSWATCH_WORKER_TICK_BUDGET_MS` | No | Soft budget; default `50000`. |
| `OPSWATCH_SELF_MONITOR_SLUG` | No | Self-monitor project slug for the heartbeat; default `opswatch-production`. |
| `WORKER_*_INTERVAL_MS` | No | Per-job cadence overrides (table above). |

Generate a strong secret (PowerShell):

```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Do not commit the secret. Use the same value in Vercel (`OPSWATCH_CRON_SECRET`)
and Supabase Vault (`opswatch_cron_secret`).

---

## Local testing

```powershell
# Unit + route + auth + lock tests (hermetic, no DB):
pnpm --filter @opswatch/api test -- worker-tick cron-auth

# Database E2E (real local Postgres from apps/api/.env):
$env:RUN_DATABASE_E2E="true"; pnpm --filter @opswatch/api test -- serverless-tick.database-e2e
```

Manual local call once the API is running (`pnpm --filter @opswatch/api dev`):

```powershell
# Set the secret in apps/api/.env first: OPSWATCH_CRON_SECRET="local-dev-secret"
curl -X POST http://127.0.0.1:4000/api/internal/worker/tick `
  -H "Authorization: Bearer local-dev-secret" `
  -H "Content-Type: application/json" `
  -d '{"trigger":"manual"}'
```

A request with no/incorrect secret must return `401`.

---

## Supabase Cron setup (production)

> Do **not** create the cron until the endpoint is deployed and returns `401`
> without the secret.

### 1. Enable extensions

- **Integrations → Cron** → Enable (installs `pg_cron`).
- **Database → Extensions** → enable `pg_net` (lets Postgres make the HTTP call).

### 2. Store URL + secret in Vault (SQL Editor)

```sql
select vault.create_secret(
  'https://api.opswatch.okanggroup.com/api/internal/worker/tick',
  'opswatch_worker_tick_url'
);
select vault.create_secret(
  'PASTE_THE_SAME_SECRET_USED_IN_VERCEL',
  'opswatch_cron_secret'
);
```

### 3. Create the cron job

**Integrations → Cron → Create job.** Name `opswatch-worker-tick`, schedule
`* * * * *` (every minute), type **SQL snippet**:

```sql
select net.http_post(
  url := (
    select decrypted_secret from vault.decrypted_secrets
    where name = 'opswatch_worker_tick_url' limit 1
  ),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'opswatch_cron_secret' limit 1
    )
  ),
  body := jsonb_build_object('trigger', 'supabase-cron', 'requestedAt', now()),
  timeout_milliseconds := 55000
) as request_id;
```

### 4. Verify

```sql
-- HTTP response (want status 200):
select * from net._http_response order by created desc limit 10;

-- Cron run bookkeeping (want status = 'succeeded'):
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details order by start_time desc limit 20;
```

A `succeeded` cron row proves Supabase *made* the request. The Vercel function
logs and the OpsWatch heartbeat prove the jobs actually ran. In **Intelligence →
AI Operations Status**, within a minute or two: Worker heartbeat = Active, and
the AI-led capabilities reflect the latest tick.

Once verified, the local `pnpm dev:worker` process can be stopped — the cron
invocation becomes the production worker heartbeat.

---

## Later: Supabase Queues (not yet)

Cron is sufficient for recurring scheduling. For durable repairs,
notifications, and retries, add **Supabase Queues** (`pgmq`) afterwards
(`opswatch-automation`, `opswatch-notifications`, `opswatch-recovery`,
`opswatch-monitoring-sync`). Queues must only be accessed by trusted
server-side code, never browsers.

Do **not** schedule cron jobs that run large SQL repairs, delete records, or
mutate production services directly. The cron's only job is to securely wake the
Vercel endpoint; OpsWatch's own policy engine decides what is safe to execute.
```
