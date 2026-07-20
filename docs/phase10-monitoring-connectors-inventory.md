# Phase 10 — Native monitoring source connectors (provider-neutral)

Inventory date: 2026-07-20  
Base commit: `9ad0f77` (Phase 9 accepted locally)

## Product position

Phase 10 delivers **first-class external monitoring connections** using provider-neutral
customer language only:

| Customer label | Internal mode |
|---|---|
| Metrics & alerts connector | `METRICS_ALERTS_CONNECTOR` |
| Application performance connector | `APPLICATION_PERFORMANCE_CONNECTOR` |
| Infrastructure monitoring connector | `INFRASTRUCTURE_MONITORING_CONNECTOR` |

Customers see **Connect monitoring source** — never vendor names or logos in UI,
API responses, database display labels, exports, or customer documentation.

## Existing foundations reused

| Area | Reuse |
|---|---|
| Connection registry + wizard | `apps/web/src/app/connections/page.tsx`, connection components |
| Managed credentials + rotation | `connection-credential.service.ts`, rotate endpoint |
| Canonical graph writer | `canonical-graph.service.ts` via `@opswatch/shared` |
| Worker scheduler | `scheduler.service.ts` |
| Change ledger evidence | `change-ledger.service.ts` |
| Org/project isolation | `Connection.organizationId`, scoped controllers |

## Phase 10 additions

### Schema

- `Connection.lastSync*` fields for provider health and last-sync status
- `Connection.syncIntervalMinutes` (default 15)
- `MonitoringSyncRun` audit table for paginated import runs

### API services (`apps/api/src/services/monitoring-connectors/`)

- `monitoring-connector-types.ts` — neutral mode constants
- `monitoring-connector-profile.registry.ts` — internal adapter profiles (server-side only)
- `monitoring-connector-http.client.ts` — pagination, retries, rate-limit backoff
- `monitoring-connector-test.service.ts` — connection testing
- `monitoring-connector-normalize.ts` — entity/signal normalization
- `monitoring-connector-sync.service.ts` — scheduled + on-demand sync, graph mapping

### Routes

- `POST /connections/:connectionId/sync` — on-demand monitoring source sync
- Existing `POST /connections/:connectionId/test` — validates monitoring sources via server-side probe
- Existing `POST /connections/:connectionId/rotate-credential` — credential rotation with probe gate

### Worker

- `run-monitoring-sync.job.ts` — `WORKER_MONITORING_SYNC_INTERVAL_MS` (default 15m)
- Disabled when `WORKER_MONITORING_SYNC_ENABLED=false`

### UI

- Monitoring connector methods in connection wizard (Preview)
- Registry columns: last sync status/summary
- Primary CTA: **Connect monitoring source**
- Manual **Sync** action for monitoring connections

## Branding enforcement

Repository search before Phase 10 found **no** Datadog/Dynatrace references in product
code. Phase 10 keeps vendor API hosts and package identifiers inside backend adapters
only. Public DTOs expose:

- `monitoringLimitations[]` — honest capability gaps
- `lastSyncStatus`, `lastSyncSummary`, `lastSyncAt`
- Neutral `connectorMode` values only

## Honest limitations (initial)

- Generic paginated JSON contract is verified locally; vendor-native payload shapes require
  per-profile adapter expansion behind neutral modes.
- Log/trace deep links may be unavailable depending on source permissions.
- Alert/incident correlation uses imported evidence; no autonomous high-risk remediation.
- Sync stops after 50 pages per run to protect runtime budgets.

## Verification plan

1. `pnpm --filter @opswatch/api typecheck`
2. `pnpm --filter @opswatch/api test` (includes `monitoring-connector.phase10.test.ts`)
3. `pnpm --filter @opswatch/web typecheck`
4. `pnpm --filter @opswatch/worker typecheck`
5. DB migration apply + connector sync database E2E (fixture HTTP source)
6. Playwright: monitoring connections wizard + sync evidence
7. Local commits only — no push/deploy

## Deferred to follow-up commits within Phase 10

- Vendor-specific adapter implementations (hidden behind neutral profiles)
- Evidence-based provider remediation action registration (Phase 7 bridge)
- Full alert → incident correlation rules for imported monitor/problem signals
- Playwright + consolidated programme readiness audit artifact
