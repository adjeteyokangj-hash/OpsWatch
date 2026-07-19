# Phase 6 — Logs and APM foundations inventory

Date: 2026-07-19  
Baseline: `ce86d9e8e7b5ee21a8d9f08b45c34fbe30a2dd6b` on `main`  
Programme source: `docs/opswatch-observability-programme.md` (Phase 6)

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. This inventory locks what already exists
for logs and application-performance monitoring before Phase 6 implementation.
Placeholders, schemas without writers, and Foundation UI do not count as
completed capability.

**Hard stop:** searchable logs and APM are not claimed. Phase 5 verification
explicitly defers them (`docs/phase5-product-truth-verification.md`). This phase
must not begin native Datadog/Dynatrace connectors or Phase 7 remediation
expansion.

---

## Existing stop points (summary)

| Exists (Phases 3–5) | Phase 6 must build |
| --- | --- |
| OTEL bridge ingest (normalized JSON + OTLP/HTTP JSON) | First-class searchable `LogRecord` (+ grouping) |
| `OtelIngestBatch` + `NormalizedOperationalSignal` spine | First-class `SpanRecord` / `TraceRecord` + reconstruction |
| Policy → `Alert` + `OtelAlertEvidence` (gated) | Service / endpoint / dependency APM windows |
| Incident correlation + `OtelIncidentEvidence` (gated) | Logs explorer UI beyond Foundation empty state |
| Entity/relationship discovery into canonical topology | Application Performance UI |
| Retention prune for OTEL tables (plan-aware) | Writers for APM aggregation (and wire or replace empty `OtelMetricWindow`) |
| Honest Logs Foundation page | Query APIs, redaction hardening, fixture evidence |
| Attribute/body redaction at normalize | Separate Logs/APM feature flags + honest UI states |

---

## Path inventory

For each path: writer, reader, persistence, queryability, retention, correlation,
UI, runtime verification, remaining gap.

### 1. OTEL LOG ingestion

| Aspect | State |
| --- | --- |
| Writer | `POST /api/internal/otel/v1/bridge/connections/:connectionId` → `otel-bridge.controller.ts` → `normalizeOtelBatch` (`otel-normalize.ts`, including OTLP `resourceLogs`) → `otel-ingest.service.ts` creates `NormalizedOperationalSignal` (`signalType` LOG/ERROR) and `OperationalObservation` with redacted `body` |
| Reader | Monitoring-depth counts (`otel-project-status.service.ts`); policy heuristics (`otel-policy.service.ts`); **no log search API** |
| Persistence | Signal row + observation JSON; no first-class log table |
| Queryability | Fingerprint / org / project indexes on signals; observation by `sourceType` / `eventKey` — **not full-text searchable** |
| Retention | Plan `telemetryDays` via `pruneOtelForOrg` (observations + unlinked signals) |
| Correlation | `traceId` / `spanId` on signal when present; alert/incident evidence when flags on |
| UI | Foundation empty Logs page only |
| Runtime verification | Phase 3 e2e / scripts (`otel-spine.database-e2e`, `otel-monitoring-depth.spec.ts`, `otel-phase3-runtime-journey.ts`) |
| Gap | No searchable log store; process-path draft rebuild can omit body → body-based policy incomplete; no grouping/occurrence product surface |

### 2. OTEL SPAN / TRACE ingestion

| Aspect | State |
| --- | --- |
| Writer | Same ingest path; SPAN / DEPENDENCY / ERROR classification in `otel-normalize.ts` (`classifySignal`); hex validation for trace/span IDs |
| Reader | Topology discovery, alert/incident evidence, monitoring-depth span counts |
| Persistence | `NormalizedOperationalSignal` with `traceId` / `spanId` / `parentSpanId`; no span-tree table |
| Queryability | `@@index([traceId, spanId])` — ID lookup possible; no waterfall / reconstruction API |
| Retention | Same telemetry prune; evidence-linked signals preserved |
| Correlation | Alert/incident evidence; incident job can group by shared `traceId` |
| UI | Trace snippets on alert/incident detail (`otel-alert-evidence`); no APM / trace explorer |
| Runtime verification | Phase 3 spine + browser evidence |
| Gap | No retained first-class spans for APM; no throughput / latency aggregates from spans; no partial-trace honesty in a product view |

### 3. NormalizedOperationalSignal

| Aspect | State |
| --- | --- |
| Writer | `otel-ingest.service.ts`; processor updates state (`otel-process.service.ts`) |
| Reader | Process job, project status, topology loaders, freshness |
| Persistence | `apps/api/prisma/schema.prisma` model `NormalizedOperationalSignal` |
| Queryability | Strong indexes (processing, fingerprint, connection, trace, freshness) |
| Retention | Deletes when old and no alert/incident evidence |
| Correlation | FK to entities; evidence FKs |
| UI | Indirect (counts / flags only) |
| Runtime verification | Phase 3 verified |
| Gap | No typed columns for metric `value` or log `body` on the signal itself; unsuitable alone as Phase 6 searchable log/APM store — retain for dual-read compatibility |

### 4. OperationalObservation

| Aspect | State |
| --- | --- |
| Writer | OTEL ingest (`payloadJson` includes body/value/correlation); also intelligence `recordObservation` |
| Reader | Count in `brain-snapshot.service.ts`; no product query UI |
| Persistence | JSON `payloadJson` |
| Queryability | Org/time/sourceType/eventKey indexes; not log-search |
| Retention | `OTEL_COLLECTOR` rows pruned by telemetryDays |
| Correlation | Nested in JSON only |
| UI | None dedicated |
| Runtime verification | Created on ingest; not product-surfaced as logs |
| Gap | Unstructured; no FK to entity; not a Phase 6 searchable log store |

### 5. OtelMetricWindow

| Aspect | State |
| --- | --- |
| Writer | **None** — no `create` / `upsert` path in `apps/` |
| Reader | Retention delete only |
| Persistence | Schema with sampleCount / sum / min / max / p95 / errorCount / health / window bounds |
| Queryability | Indexes exist; empty in practice |
| Retention | Pruned by `windowEnd < cutoff` |
| Correlation | Optional `batchId` / `entityId` |
| UI | None |
| Runtime verification | Schema + cleanup only |
| Gap | Critical: implement APM aggregation writers (extend this model and/or add `Apm*Window` models) and consumers for latency / throughput / errors |

### 6. OtelAlertEvidence

| Aspect | State |
| --- | --- |
| Writer | `otel-alert.service.ts` when `OPSWATCH_OTEL_ALERT_GENERATION_ENABLED=true` |
| Reader | Alerts API / UI |
| Persistence | Relational evidence + optional signal / batch / entity / relationship |
| Queryability | By alertId, org + traceId |
| Retention | Protects linked signals/batches from prune |
| Correlation | Feeds incident correlation via traces |
| UI | `data-testid="otel-alert-evidence"` |
| Runtime verification | Phase 3 e2e + browser |
| Gap | Evidence ≠ searchable logs/APM; no browse-by-trace product; Phase 6 must link log groups / spans / APM windows into the same spine |

### 7. OtelIncidentEvidence

| Aspect | State |
| --- | --- |
| Writer | `run-incident-correlation.job.ts` `backfillOtelIncidentEvidence` when correlation flag on |
| Reader | Incidents API / UI |
| Persistence | Includes `candidateRootCause`, `propagationDirection` |
| Queryability | By incidentId, org + traceId |
| Retention | Same evidence protection |
| Correlation | Fingerprint + shared trace grouping |
| UI | Incident detail OTEL evidence |
| Runtime verification | Runtime journey + Phase 3 close-out |
| Gap | Must display log groups, trace evidence, metric windows, likely dependency — without inventing data |

### 8. Retention jobs

| Aspect | State |
| --- | --- |
| Runner | `prune-retention.job.ts` → `runRetentionSweep` → `pruneOtelForOrg` (`apps/worker/src/services/retention.service.ts`) |
| What pruned | Metric windows, unlinked signals, empty batches, OTEL observations, OTEL timeline, expired `ingestReplayNonce` (`route: otel-bridge`) |
| Policy | Entitlement keys `retention.telemetry.days` / `telemetry.retention_days` |
| Batch expiry | `OPSWATCH_OTEL_BATCH_EXPIRY_MS` default 7d on ingest |
| Runtime verification | Unit tests on policy resolution; prune implemented |
| Gap | No LogRecord / SpanRecord / ApmWindow / LogOccurrenceGroup cleanup yet; preserve incident/remediation evidence summaries when raw data expires |

### 9. Redaction

| Aspect | State |
| --- | --- |
| Writer path | `otel-redaction.ts`: attribute allowlists, sensitive key drop, body truncate 1024, secret URL/patterns; `sanitizeAuditMetadata` |
| Also | Collector example `examples/otel-collector/document-platform.yaml` collector-side redact |
| Readers | Applies at normalize before persist |
| Runtime verification | Covered indirectly by normalize / bridge tests |
| Gap | Phase 3 inventory note that bodies are only truncated is **stale** — `redactLogBody` content-redacts. Phase 6 must add recursive object redaction, org-configurable rules, payment-card / session patterns, redaction audit metadata without originals, and prove secrets absent from DB / API / alerts / incidents / audit |

### 10. Service / entity resolution

| Aspect | State |
| --- | --- |
| Writer | `otel-identity.service.ts` via canonical graph — SERVICE / instance HOST\|CONTAINER / dependency DATABASE\|QUEUE\|EXTERNAL_API |
| Reader | Topology UI, alert entity links |
| Persistence | `OperationalEntity` + legacy `Service` link |
| Flags | Always on process path for service/instance; dependency gated by topology discovery |
| Runtime verification | Phase 3 / 4 |
| Gap | Phase 6 must reuse canonical IDs — do not introduce a new Service authority |

### 11. Relationship discovery

| Aspect | State |
| --- | --- |
| Writer | `otel-dependency.service.ts` + process when `signalType === DEPENDENCY` and `OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED`; evidence threshold default 3 |
| Reader | Canonical topology + dual-write `ServiceDependency` |
| Separate gate | `OPSWATCH_LEARNED_TOPOLOGY_ENABLED` for non-OTEL observation-driven discovery |
| Runtime verification | Phase 3 / 4 |
| Gap | APM dependency summaries must read these relationships and update latency / error / freshness — not re-author topology |

### 12. Alert policies

| Aspect | State |
| --- | --- |
| Engine | `otel-policy.service.ts` — metric name heuristics, log severity/body heuristics, span/dependency errors, freshness stale |
| Emitter | `otel-alert.service.ts` → `createAlert` source `OTEL_POLICY` |
| Runtime verification | Phase 3 |
| Gap | Hard-coded thresholds; metric value often unavailable at process time; no user-editable OTEL policies UI; Phase 6 needs log-group / APM threshold alerts with deterministic fingerprints, suppression, recovery |

### 13. Incident correlation

| Aspect | State |
| --- | --- |
| Job | `run-incident-correlation.job.ts` — fingerprint / trace grouping; writes `OtelIncidentEvidence` |
| Flag | `OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED` (default off) |
| Also | `alert-correlation.service.ts` shared-trace grouping |
| Runtime verification | Phase 3 |
| Gap | Correlate log groups, APM degradation, deployments; show confidence and evidence windows honestly |

### 14. Topology integration

| Aspect | State |
| --- | --- |
| Writers | Identity + dependency → canonical graph; service status update on healthImpact |
| Reader flag | `OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED` (production default must remain unchanged) |
| UI | Topology drawers show OTEL freshness/signals; overlay labelled Foundation/Preview |
| Runtime verification | Phase 4 unification + Phase 3 UI evidence |
| Gap | Update relationship colours from APM evidence (green/amber/red/grey); related log-error and trace counts; stale → Unknown; project heartbeat must not refresh APM evidence |

### 15. Logs UI

| Aspect | State |
| --- | --- |
| Page | `apps/web/src/app/projects/[projectId]/log-streams/page.tsx` — Foundation empty state; explicitly points to Phase 6 |
| Nav | Secondary link from settings; not primary workspace nav |
| Path note | Logs live at `log-streams` to avoid gitignored `logs` path |
| Runtime verification | Product-truth labelling only |
| Gap | Genuine initial explorer: filters, results, grouping, correlation indicators, empty/not-connected states — no fake stream counts |

### 16. Application performance UI

| Aspect | State |
| --- | --- |
| Exists? | **No** APM / Performance page or route |
| Closest | Metrics page = check latency; reliability SLOs; topology sparkline |
| Gap | Full initial Performance experience under Application → Performance |

### 17. Latency / error dashboards

| Aspect | State |
| --- | --- |
| Check latency | `projects/[projectId]/metrics/page.tsx` — `CheckResult.responseTimeMs` |
| SLO | `reliability/page.tsx` — availability/error-rate/latency from checks |
| OTEL | Policy can *alert* on latency/error metric names; **no dashboard** over metric windows or spans |
| Gap | APM summaries from persisted telemetry with sample-count honesty |

### 18. Feature flags

| Flag | Default | Notes |
| --- | --- | --- |
| `OPSWATCH_OTEL_INGESTION_ENABLED` | `false` | Master ingest |
| `OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED` | off unless `"true"` | Dependencies |
| `OPSWATCH_OTEL_ALERT_GENERATION_ENABLED` | off | Alerts |
| `OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED` | off | Incidents |
| `OPSWATCH_LEARNED_TOPOLOGY_ENABLED` | `false` | Non-OTEL discovery |
| `OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED` | not production-default-on | Do not change production default |
| Limits | payload bytes, max signals, instance/dependency caps, freshness TTLs | See `otel-feature-flags.ts` / normalize / identity |

**Missing for Phase 6:** separate `OPSWATCH_LOGS_INGESTION_ENABLED`, `OPSWATCH_LOGS_EXPLORER_ENABLED`, `OPSWATCH_TRACE_APM_PROCESSING_ENABLED`, `OPSWATCH_APM_UI_ENABLED` (and/or clear reuse of OTEL flags with honest UI states). Alert generation for logs/APM should remain gated.

### 19. Test fixtures

| Asset | Path / note |
| --- | --- |
| Unit | `otel-normalize.test.ts`, `otel-bridge.controller.test.ts`, `otel-bridge.service.test.ts`, processor parity |
| DB e2e | `otel-spine.database-e2e.test.ts` (`RUN_DATABASE_E2E=true`) |
| Browser | `apps/web/e2e/otel-monitoring-depth.spec.ts` |
| Scripts | `scripts/otel-phase3-*.ts` |
| Retail fixture | `apps/api/src/fixtures/retail-checkout.fixture.ts` — incident Scenario A, **not** OTEL logs/APM |
| Collector example | `examples/otel-collector/*` |

**Gap:** controlled Phase 6 fixtures (healthy traffic, elevated latency, critical errors, repeated exceptions, failing DB/external spans, partial/late/duplicate traces, stale telemetry, redaction cases) marked test-only — never presented as Noble Express live telemetry.

### 20. Seeded or placeholder data

| Item | State |
| --- | --- |
| Prisma seed | No OTEL/log/APM seed in `apps/api/prisma/seed.ts` |
| Logs UI | Placeholder/empty by design (honest Foundation) |
| Monitoring depth | Live counts when signals exist; else honest disconnected |
| Graph seeds | Noble/Starliz topology seeds — unrelated to log search |
| Predictions | Explicitly not live (Phase 5) |

---

## Compatibility constraints for Phase 6

1. **Additive migrations only.** Do not remove `NormalizedOperationalSignal`,
   `OperationalObservation`, or existing OTEL evidence models. Dual-write new
   Log/Span/APM tables from the ingest/process path; document dual-read.
2. **Reuse canonical** `OperationalEntity` / `OperationalRelationship` IDs.
   Do not introduce a new Service/ServiceDependency authority.
3. **Keep production defaults** for OTEL and canonical topology flags unchanged
   unless explicitly approved. New Logs/APM flags default off.
4. **Do not claim** Datadog- or Dynatrace-level parity.
5. **No push / deploy / production modification** without explicit approval.
6. **Out of scope:** session replay, RUM, continuous profiling, packet-level
   network monitoring, Kubernetes-specific collectors, full infrastructure
   monitoring, native Datadog/Dynatrace import, long-term data-lake analytics,
   natural-language log investigation, Phase 7 remediation expansion.

---

## Recommended Phase 6 commit sequence

1. This inventory  
2. Log and trace schema (additive)  
3. Log ingest / search / grouping + redaction  
4. Trace reconstruction and APM aggregation  
5. Alert / incident / topology correlation  
6. Logs and Performance UI  
7. Retention / security hardening  
8. Tests and verification fixes  

---

## Acceptance gate (programme)

Phase 6 is complete only when first-class searchable logs, redaction-before-persist,
search/filter/pagination, grouping, span-based trace reconstruction, evidence-based
service/endpoint/dependency APM, alert/incident/topology integration, freshness and
retention cleanup, real UI evidence, tests/build, and local commits are verified —
with nothing pushed or deployed.
