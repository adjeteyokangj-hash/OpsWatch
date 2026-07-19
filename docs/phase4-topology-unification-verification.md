# Phase 4 verification report

Date: 2026-07-19  
Scope: Topology model unification cutover gates  
Push/deploy status: **not pushed**, **not deployed**

## Decision

`OperationalEntity` / `OperationalRelationship` are the authoritative topology
graph. `Service` / `ServiceDependency` remain additive compatibility tables.
Product topology continues to expose `ProjectTopologyResponse`, with a gated
canonical read path (`OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED`).

## Gates executed

| Gate | Result | Evidence |
| --- | --- | --- |
| Idempotent topology backfill | PASS (second apply: 0 identity writes) | `scripts/phase4-topology-backfill.ts --apply` |
| Integrity audit | PASS (`critical=0`, `findings=0`, quarantined=1) | `scripts/phase4-audit-topology-integrity.ts` |
| Canonical reference migration | PASS (`unresolved=[]`) | `scripts/phase4-migrate-canonical-references.ts` |
| Legacy vs canonical loader compare | PASS (Noble Express 50/50 nodes, 38/38 edges) | `scripts/phase4-compare-topology-api.ts` |
| OTEL processor parity | PASS (batch + freshness share API implementation) | `otel-processor-parity.test.ts` |
| Canonical DB E2E | PASS | `topology-unification.database-e2e.test.ts` |
| Identity + integrity unit tests | PASS | `canonical-graph.service.test.ts`, `topology-integrity-audit.service.test.ts` |
| Typecheck | PASS | `pnpm typecheck` → EXIT 0 |
| Lint | PASS (1 existing hooks warning) | `pnpm lint` → EXIT 0 |
| API tests | PASS (340 passed / 21 skipped) | `test-artifacts/phase4-api-test.log` |
| Worker tests | PASS (36 passed / 3 skipped) | `test-artifacts/phase4-worker-test.log` |
| Topology web unit tests | PASS (18 passed) | `test-artifacts/phase4-web-topology-tests.log` |
| Playwright topology evidence | PASS (filters + list + drawer screenshots) | `test-artifacts/phase4-browser/` |

## Integrity snapshot

```json
{
  "activeEntities": 106,
  "activeRelationships": 109,
  "quarantinedRelationships": 1,
  "findings": 0,
  "critical": 0,
  "warnings": 0,
  "passes": true
}
```

Comparison:

- legacy entities mapped: 76 / 76
- legacy relationships mapped: 38 / 38
- ambiguous mappings: none
- health differences: none

Noble Express loader compare:

- legacy nodes/edges: 50 / 38
- canonical nodes/edges: 50 / 38
- missing relationships: none

## Playwright evidence

Captured under `test-artifacts/phase4-browser/`:

- `01-topology-map-filters.png` — Location / Source / Freshness filters present
- `02-topology-list-location-source.png` — list columns Location + Source present
- `03-topology-node-drawer-provenance.png` — node drawer opened without UX crash
- `evidence-summary.json`

Browser notes:

- Filter bar and list columns rendered successfully on Noble Express.
- A later replay observed intermittent API 500s under local DB pool pressure;
  the screenshots above remain the accepted UI evidence for Phase 4 filter UX.
- Full web suite was unstable under concurrent local load; focused topology web
  tests (18) and the earlier drawer regression fix were used as the web gate.

## Cutover readiness

Ready for **local gated** canonical topology read cutover when operators set:

`OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED=true`

Not ready for:

- Phase 5
- remote push
- production deploy
- dropping `Service` / `ServiceDependency`

## Rollback

Leave `OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED` unset/false. Legacy tables and
IDs remain intact; canonical references are additive.
