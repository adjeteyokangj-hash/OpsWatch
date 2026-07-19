# Phase 6 schema compatibility — Logs and APM

Additive models introduced in migration
`20260719200000_phase6_logs_apm_foundations` do **not** replace the Phase 3
OTEL operational spine.

## Retained models (dual-read)

| Model | Phase 6 role |
| --- | --- |
| `NormalizedOperationalSignal` | Continues as operational spine input for policy, freshness, topology discovery |
| `OperationalObservation` | Continues as generic fact bag; not the searchable log store |
| `OtelIngestBatch` | Shared ingest batch / idempotency |
| `OtelMetricWindow` | Legacy/empty metric window schema; new APM uses `Apm*Window` |
| `OtelAlertEvidence` / `OtelIncidentEvidence` | Remain primary OTEL evidence tables; Phase 6 adds typed link tables |

## Dual-write behaviour

When `OPSWATCH_LOGS_INGESTION_ENABLED=true`, LOG/ERROR signals also persist
`LogRecord` (+ `LogOccurrenceGroup`) at ingest time.

When `OPSWATCH_TRACE_APM_PROCESSING_ENABLED=true`, SPAN/DEPENDENCY signals also
persist `SpanRecord` / `TraceRecord` and contribute to `Apm*Window` aggregation
during process.

Query APIs for Logs/APM read the new first-class tables. Alert/incident policy
continues to evaluate normalized signals and may attach both OTEL evidence and
Phase 6 link rows.

## Flags

New flags default **off**. Existing OTEL and canonical topology production
defaults are unchanged.
