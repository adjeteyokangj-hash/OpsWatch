# Local live-heal — PROVEN (2026-07-16)

**Status: PROVEN** — Fix→recover completed locally against the mock remediator.

## Evidence

File: `test-artifacts/live-heal-local-evidence.json`

| Check | Result |
|-------|--------|
| Remediator health `:8791` | `ok: true`, `role: local-mock-remediator` |
| Handshake | `VALID` — "Remediator connected and validated." |
| Repair | `COMPLETED` — `restart_sync_worker` |
| Attempt DB status | `COMPLETED` (`attemptId` `58e75bfa-…`) |
| Project | `smoke-isolation-app-b` |

Proven at: `2026-07-16T17:10:32.821Z` via `pnpm exec tsx scripts/prove-live-heal-local.ts`.

## Stack at proof time

| Component | Status | Notes |
|-----------|--------|--------|
| Postgres `:5432` | OK | Listening; fixtures + Prisma OK |
| Redis `:6379` | OK | Docker `opswatch-redis` (`6379:6379`) |
| API `:4000` | OK | `/api/health` → 200 |
| Web `:3000` | OK | `next dev` (no production `.next`; `next start` needs build). `/login` → 200 |
| Mock remediator `:8791` | OK | `GET /health` → `{"ok":true,"role":"local-mock-remediator"}` |
| TrueNumeris remediator | Not used | Proof used mock on `:8791` |

## Earlier blockers (resolved)

1. **SHELL_HARNESS_BROKEN** — Agent Shell hung with empty stdout; recovered with unrestricted shell (`required_permissions: all`). Prefer short probes that write artifacts under `test-artifacts/stack-logs/` if harness flakes.
2. **Postgres hang (prior session)** — Port listen alone was misleading; DB usable again for fixtures + prove.
3. **Smoke stack `-SkipBuild`** — Web `next start` fails without `.next`; use `next dev` or build web first. Not required for `prove-live-heal-local.ts`.

## Not yet proven

- TrueNumeris / Noble remediator (TN env still lacks `OPSWATCH_REMEDIATOR_*`).
- UI Fix→recover click path (API path proven; UI not exercised this run).

## Reproduce

```powershell
# Redis (if needed)
docker start opswatch-redis

# Mock remediator
node scripts/mock-remediator-server.mjs

# API (+ optional web). Prefer full build, or API alone + `next dev` for web.
powershell -ExecutionPolicy Bypass -File scripts/start-local-smoke-stack.ps1

# Fixtures + proof
pnpm exec tsx scripts/ensure-smoke-fixtures.ts
pnpm exec tsx scripts/prove-live-heal-local.ts
```

Do not mark TN/Noble remediator ready until the same path succeeds against a TN-configured remediator.
