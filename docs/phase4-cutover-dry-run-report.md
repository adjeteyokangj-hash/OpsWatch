# Phase 4 canonical-topology cutover dry-run report

**Date:** 2026-07-19  
**Scope:** Local dry-run only. Production default unchanged. Nothing pushed or deployed. Phase 5 not started.

## Summary

| Item | Result |
|------|--------|
| Canonical read | **PASS** — `reader: CANONICAL`, `fallbackUsed: false` |
| Silent legacy fallback | **None** (see explained cases below) |
| Noble nodes / relationships | **50 / 38** |
| Write path | **PASS** |
| Alert / incident / automation refs | **PASS** |
| Rollback | **PASS** (LEGACY ↔ CANONICAL, counts unchanged) |
| Pushed / deployed | **No** |

## 1. Local flag enablement

- Set `OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED=true` in:
  - `apps/api/.env` (API process)
  - `apps/web/.env.local` (embedded/proxy path — Next can serve topology in-process)
- Production defaults untouched (`.env.api.production` not modified).
- Added development-only `readerDiagnostic` on `ProjectTopologyResponse` + UI banner (`data-testid="topology-reader-diagnostic"`).

## 2. Canonical read result (Noble Express)

```
reader: CANONICAL
fallbackUsed: false
canonicalEntityCount: 50
canonicalRelationshipCount: 38
legacyFallbackCount: 0
unresolvedCanonicalReferences: 0
layers: APP=1 MODULE=13 WORKFLOW=19 COMPONENT=17
edges: HIERARCHY=28 DEPENDENCY=10
```

Verified via direct API and web proxy after stack restart.

## 3. Legacy fallback findings (none silent)

| Case | Silent? | Detail |
|------|---------|--------|
| Whole-loader fallback on Postgres P1001 | **No** — logged + `fallbackUsed: true` + diagnostic details | Transient `Can't reach database server at localhost:5432` during canonical loader; explicit catch path used |
| Per-reference mapping for unmigrated RESOLVED/OPEN check alerts | **No** — counted in `legacyFallbackCount` + details | Worker `upsertCheckAlert` / SSL alert writers previously omitted `operationalEntityId`. Fixed + re-ran `phase4-migrate-canonical-references` |
| After fixes | **None** | `legacyFallbackCount: 0`, `unresolvedCanonicalReferences: 0` |

## 4. Write-path result (`zz-cutover-temp`)

- URL-monitored app provisioned (`example.com`) with HTTP + SSL checks + canonical WEBSITE entity
- Heartbeat created/updated APP canonical entity
- OTEL_BRIDGE entities + OTEL_COLLECTOR relationship created via shared `CanonicalGraphService`
- Manual COMPONENT + relationship created with **0** legacy `ServiceDependency` rows
- Live topology reader showed all entities/relationships (`WRITE_PATH_PASS`)
- Temp project removed after verification

## 5. Alert / incident / automation refs

| Check | Result |
|-------|--------|
| Failing check alert references canonical entity | PASS (after `alerting.service` + worker HTTP/SSL writers) |
| Dependency alert references canonical relationship | PASS |
| Incident affected entities resolve canonically | PASS (`IncidentTopologyReference`) |
| Selected line evaluates automation | PASS (`resolveAutomationRelationshipTarget`) |
| Recovery updates canonical health | PASS (DOWN → HEALTHY via heartbeat) |

## 6. Rollback

1. Disabled flag in api + web env, restarted → API and web proxy both `reader: LEGACY`, 50 nodes
2. Integrity counts unchanged: entities=51, rels=88, mappings=50, services=50, deps=38, identities=51
3. Re-enabled flag, restarted → `reader: CANONICAL`, `fallbackUsed: false`, 50/38, counts unchanged
4. No duplication or corruption observed

## 7. Verification gates (exact counts)

| Gate | Result |
|------|--------|
| `pnpm typecheck` | **PASS** (exit 0) |
| `NODE_ENV=test pnpm test` | **PASS** — API 340 passed / 21 skipped; Web 136 passed; Worker 36 passed / 3 skipped (**512 passed**, 24 skipped) |
| `RUN_DATABASE_E2E=true` topology unification E2E | **PASS** — 1/1 |
| `pnpm lint` | **PASS** (exit 0; 1 pre-existing hooks warning) |
| `pnpm build` | **PASS** (exit 0) |
| Focused Playwright cutover evidence | **PASS** (artifacts under `test-artifacts/phase4-cutover/`) |
| Complete web Playwright suite | Attempted once (see log `gate-web-e2e.log`) |

### Test fixes required during dry-run

1. `topology-loader.service.test.ts` — pin legacy flag so local cutover env does not divert unit coverage
2. `run-http-checks.job.test.ts` — mock `project` + `legacyServiceEntityMapping` after canonical alert refs

## 8. Screenshots

Under `test-artifacts/phase4-cutover/`:

- `01-canonical-reader-diagnostic.png`
- `02-noble-full-topology.png`
- `03-location-filter.png`
- `04-provenance-filter.png`
- `05-freshness-filter.png`
- `06-relationship-drawer.png`
- `07-automation-state.png`
- `08-otel-relationship.png`
- `09-url-monitored-entity.png`
- `10-mobile-topology.png`
- `11-rollback-verification.png` / `11-rollback-restored-canonical.png`
- `capture-summary.json`, `edge-capture-summary.json`, `rollback-summary.json`

## 9. Defects found and corrected

1. **Worker/API check alerts omitted `operationalEntityId`** → recurring `legacyFallbackCount` as checks re-fired. Fixed in:
   - `apps/api/src/services/alerting.service.ts`
   - `apps/worker/src/jobs/run-http-checks.job.ts`
   - `apps/worker/src/jobs/run-ssl-checks.job.ts`
2. **Web embedded path ignored API-only env flag** → set flag in `apps/web/.env.local` for local dry-run
3. **Unit tests broken by local cutover flag / new worker queries** → test fixes above

## 10. Stop conditions

- Cutover dry-run complete locally
- Canonical reading remains a **local** opt-in via env (not production default)
- Legacy `Service` / `ServiceDependency` retained for rollback
- **Nothing pushed or deployed**
- **Phase 5 not started**
