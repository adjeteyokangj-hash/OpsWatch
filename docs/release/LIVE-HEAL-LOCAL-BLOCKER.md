# Local live-heal (2026-07-16)

**Status: PROVEN** (local mock remediator) — Fix→recover handshake + repair `COMPLETED` against `http://127.0.0.1:8791/`.

## Evidence (2026-07-16 ~18:10 UTC+1)

Wrote `test-artifacts/live-heal-local-evidence.json`:

| Field | Value |
|-------|--------|
| `proven` | `true` |
| Remediator | `local-mock-remediator` `:8791` |
| Handshake | `VALID` — capabilities include `restart_sync_worker`, etc. |
| Repair | `COMPLETED` — `restart_sync_worker` (attempt `4bb1c8c7-…`, DB `COMPLETED`) |
| Project | `smoke-isolation-app-b` (`4a0e2442-…`) |

## Stack at proof time

| Component | Status | Notes |
|-----------|--------|--------|
| Postgres `:5432` | OK | Prisma usable (`db=true` in wait poll; fixtures OK) |
| Redis `:6379` | OK | Docker `opswatch-redis` (`redis:7-alpine`) started this session |
| API `:4000` | OK | `/api/health` → `ok` |
| Web `:3000` | DOWN | `next start` failed: no production `.next` build (`-SkipBuild`). **Not required** for `prove-live-heal-local.ts` |
| Mock remediator `:8791` | OK | `GET /health` → `{"ok":true,"role":"local-mock-remediator"}` |

Full `start-local-smoke-stack.ps1 -SkipBuild` still fails on web until `pnpm --filter @opswatch/web build` (or use `next dev`).

## Not yet proven

- TrueNumeris / Noble remediator (TN env still lacks `OPSWATCH_REMEDIATOR_*`).
- UI Fix→recover click path (web not up).

## How to re-run

1. Redis: `docker start opswatch-redis` (or `docker run -d --name opswatch-redis -p 6379:6379 redis:7-alpine`)
2. API: `scripts/start-local-smoke-stack.ps1` (build web if you need `:3000`) or run API alone
3. Mock remediator on `:8791`
4. `pnpm exec tsx scripts/ensure-smoke-fixtures.ts`
5. `pnpm exec tsx scripts/prove-live-heal-local.ts`
