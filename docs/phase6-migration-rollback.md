# Phase 6 migration rollback limitations

Migration: `20260719200000_phase6_logs_apm_foundations`

## Applied state

- Additive only: creates Log/Span/Trace/APM/evidence tables and indexes.
- Does **not** drop or alter Phase 3 OTEL spine tables.
- Existing `NormalizedOperationalSignal`, alerts, incidents, and topology rows remain intact.

## Rollback limitations

Prisma does not ship an automatic down migration for this folder. Manual rollback would require:

1. Dropping Phase 6 evidence link tables first (`ApmEvidenceLink`, `SpanEvidenceLink`, `LogEvidenceLink`).
2. Dropping window/span/trace/log tables afterward.
3. Leaving OTEL spine tables untouched.

Do **not** roll back in shared environments without an explicit backup. Forward-only is the supported path for Phase 6 foundations.
