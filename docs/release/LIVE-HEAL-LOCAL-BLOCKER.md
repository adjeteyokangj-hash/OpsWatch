# Local live-heal — status

## PROVEN-vs-TN (2026-07-16) — TrueNumeris remediator

**Status: PROVEN against TN** (remediator-only mode on `local:4100`).

| Check | Result |
|-------|--------|
| Mode | remediator-only (`test-artifacts/tn-remediator-only-server.mjs`) — full TN hung on `createApp()` |
| URL | `http://127.0.0.1:4100/api/internal/opswatch/remediator` |
| Health | `ok: true`, `role: truenumeris-opswatch-remediator` |
| Handshake | `VALID` — "Remediator connected and validated." |
| Repair | `COMPLETED` — `restart_sync_worker` |
| Attempt DB | `COMPLETED` (`attemptId` `65b7f621-…`) |
| Project | `app-noble-express` / `noble-express` |
| Evidence | `test-artifacts/live-heal-tn-evidence.json` |

Proven at: `2026-07-16T18:39:02.080Z` via `pnpm exec tsx scripts/prove-live-heal-local.ts` with nested health URL fix (`${webhook}/health`).

See also: `docs/release/NOBLE-TN-REMEDIATOR-LOCAL.md`.

---

## Earlier: PROVEN against mock (2026-07-16)

**Status: PROVEN** — Fix→recover completed locally against the mock remediator.

File: `test-artifacts/live-heal-local-evidence.json` (may be overwritten by later TN runs; prefer `live-heal-tn-evidence.json` for TN).

| Check | Result |
|-------|--------|
| Remediator health `:8791` | `ok: true`, `role: local-mock-remediator` |
| Handshake | `VALID` — "Remediator connected and validated." |
| Repair | `COMPLETED` — `restart_sync_worker` |
| Project | `smoke-isolation-app-b` |

Proven at: `2026-07-16T17:10:32.821Z` against mock `:8791`.

## Stack at proof time

| Component | Status | Notes |
|-----------|--------|--------|
| Postgres `:5432` | OK | Listening; fixtures + Prisma OK |
| Redis `:6379` | OK | Docker `opswatch-redis` (`6379:6379`) |
| API `:4000` | OK | `/api/health` → 200 |
| Web `:3000` | Optional | Not required for prove script |
| Mock remediator `:8791` | OK (unused for TN proof) | Leave running if desired |
| TN remediator `:4100` | OK | remediator-only; full TN hung |

## Earlier blockers (resolved)

1. **SHELL_HARNESS_BROKEN** — Agent Shell hung with empty stdout; recovered with unrestricted shell (`required_permissions: all`).
2. **Postgres hang (prior session)** — Port listen alone was misleading; DB usable again.
3. **Nested health URL** — `new URL("/health", webhook)` broke TN path `/api/internal/opswatch/remediator`; fixed to append `/health` to webhook base.
4. **TN remediator env dropped** — `OPSWATCH_REMEDIATOR_*` missing from TN `.env` mid-session; restored via `seed-noble-tn-local.cjs`.
5. **Full TN hang** — `PORT=4100` + `tsx src/index.ts` did not become healthy within 25s; remediator-only used instead.

## Not yet proven

- Full TrueNumeris `createApp()` boot on `:4100` (hung locally; remediator-only is sufficient for remediator proof).
- UI Fix→recover click path (API path proven; UI not exercised this run).

## Reproduce (TN)

```powershell
cd "C:\Users\edwar\OneDrive\My Project\TrueNumeris\server"
$env:PORT='4100'
node --import tsx "C:/Users/edwar/Documents/Projects/opswatch/test-artifacts/tn-remediator-only-server.mjs"

cd C:\Users\edwar\Documents\Projects\opswatch
$env:LIVE_HEAL_REMEDIATOR_URL='http://127.0.0.1:4100/api/internal/opswatch/remediator'
$env:LIVE_HEAL_PROJECT_SLUG='noble-express'
pnpm exec tsx scripts/prove-live-heal-local.ts
```

Do not push until explicitly asked.
