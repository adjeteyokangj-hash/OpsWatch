# OTEL Operational Spine Inventory (Phase 3)

Inventory date: 2026-07-19  
Baseline commit: `fc335a41795972737940c70084d3c27af5c9ac64`  
Status: inventory complete; implementation must close the stop-point below before Phase 4.

This document locks the audit of the gated OpenTelemetry bridge before Phase 3
code changes. Payload acceptance alone does not count as an operational signal
path.

## Current stop-point

The OpenTelemetry path ends synchronously inside
`apps/api/src/services/otel-bridge.service.ts` → `ingestOtelBridgePayload()`
after:

1. Upserting one `OperationalEntity` of type `SERVICE`.
2. Creating one `OperationalObservation` per normalized signal.
3. Creating one `OperationsTimelineEvent` per signal.
4. Updating connection health and writing an acceptance audit log.
5. Returning HTTP `202`.

It does **not** create `Alert`, `Incident`, `ServiceDependency`, or
`OperationalRelationship` records, recalculate product topology health, enqueue
worker work, enforce OTEL freshness, or retain/prune OTEL observations.

## Path inventory

### Ingestion route and auth

| Item | Current state |
|------|---------------|
| Route | `POST /api/internal/otel/v1/bridge/connections/:connectionId` |
| Mount | Outside session `requireAuth`; controller-specific auth |
| Feature flag | `OPSWATCH_OTEL_INGESTION_ENABLED === "true"` (default off) |
| Connection | Active `OTEL_COLLECTOR` connection by ID |
| Credentials | Managed ACTIVE/GRACE or legacy ciphertext or `env://` secretRef |
| Auth modes | HMAC (`X-OpsWatch-Timestamp/Nonce/Signature`) or static `X-OpsWatch-Connection-Key` |
| Replay | `IngestReplayNonce` with global `nonce` PK; expiry not enforced |
| Payload limit | Default 512 KiB, capped at 1 MiB |

Files:
- `apps/api/src/controllers/otel-bridge.controller.ts`
- `apps/api/src/services/otel-bridge.service.ts`
- `apps/api/src/routes/connection-ingest.routes.ts`
- `apps/api/src/services/credentials/connection-credential.service.ts`

### Accepted formats

1. OpsWatch normalized JSON (`resource` + `signals[]` of METRIC/LOG/SPAN).
2. OTLP/HTTP JSON (`resourceMetrics` / `resourceLogs` / `resourceSpans`).

Gaps:
- Only the first resource group identity is applied to the whole batch.
- Only the first metric data point is kept.
- OTLP log `traceId`/`spanId` are not copied.
- Trace/span hex format is not validated.

### Storage today

| Store | Role |
|-------|------|
| `OperationalEntity` | One SERVICE node per `otel:<serviceName>:<env>` |
| `OperationalObservation` | JSON payload per signal; no FK to entity |
| `OperationsTimelineEvent` | Parallel timeline facts |
| Trace/span IDs | Inside `payloadJson.correlation` only |

### Redaction

`redactOtelAttributes()` drops sensitive-looking keys and non-allowlisted keys.
Signal bodies are truncated, not content-redacted. Credentials must never appear
in stored evidence, logs, or audit metadata.

### Downstream consumers

| Consumer | OTEL effect today |
|----------|-------------------|
| Worker scheduler | None |
| `createAlert` / alerting.service | None |
| Incident correlation | None (advanced trace helper unused) |
| Product topology (`Service`/`ServiceDependency`) | None |
| Operational graph health | Entity lastSeen refreshed only |
| Monitoring-depth UI | Logs/traces hard-coded `NOT_CONNECTED` |
| Retention | Does not prune OTEL observations/timeline/replay |

### Feature flags

Only ingestion is gated. There are no separate topology/alert/incident
processing flags, so accepted payloads can silently imply downstream effects
that do not exist.

## Root-cause matrix

| Gap | Root cause | Phase 3 target |
|-----|------------|----------------|
| No alerts/incidents | Bridge writes facts only | Normalized signals → policy → `createAlert` → incident spine |
| No relationships | No dependency discovery | Span/attribute-driven candidates with evidence thresholds |
| Topology unchanged | Product loader ignores OTEL | Adapter overlay + ServiceDependency evidence dual-write |
| No freshness | Connection stays HEALTHY forever | Per-signal freshness deadlines + stale jobs |
| No retention | Retention service omits OTEL tables | Plan-aware batched prune of batches/signals/observations |
| Trace IDs JSON-only | No typed columns/links | Normalized fields + alert/incident evidence tables |
| Replay never expires | Global nonce PK, no cleanup | Scoped idempotency + expiry cleanup |
| Managed revoke fallback | Legacy ciphertext still resolved | Prefer managed family; no legacy fallback when family exists |
| Monitoring depth dishonest | Hard-coded NOT_CONNECTED | Honest OTEL connected/status/feature flags |

## Compatibility constraints

1. Additive migrations only; retain `OperationalObservation` during Phase 3.
2. Do not unify topology models (Phase 4). Dual-write/adapt into existing
   `Service`/`ServiceDependency` consumers where needed.
3. Keep OTEL ingestion disabled by default.
4. Do not claim full Logs/APM product surfaces; label foundations honestly.
5. No push/deploy without explicit approval.

## Out of Phase 3 scope

- Topology-model unification (Phase 4)
- Cosmetic feature replacement (Phase 5)
- Full searchable logs / APM explorer (Phase 6)
- Native Datadog/Dynatrace connectors (Phase 10)
