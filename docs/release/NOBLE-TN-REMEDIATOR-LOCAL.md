# Noble ↔ TrueNumeris for OpsWatch remediator (local)

## Status: PROVEN-vs-TN (2026-07-16)

Local Fix→recover proven against the **TrueNumeris remediator** (not the mock on `:8791`).

| Field | Value |
|-------|--------|
| Proven at | `2026-07-16T18:39:02.080Z` |
| Mode | **remediator-only** (`tn-remediator-only-server.mjs` on `:4100`) — full TN `npm run`/`createApp()` hung within ~25s |
| URL class | `local:4100` → `http://127.0.0.1:4100/api/internal/opswatch/remediator` |
| Health role | `truenumeris-opswatch-remediator` |
| Handshake | `VALID` — "Remediator connected and validated." |
| Repair | `COMPLETED` — `restart_sync_worker` (attempt `65b7f621-…`) |
| Project | `app-noble-express` / slug `noble-express` |
| Evidence | `test-artifacts/live-heal-tn-evidence.json` |

## What “add Noble to TrueNumeris” means here

Three different things get conflated:

| Layer | Meaning | Needed for remediator? |
|-------|---------|------------------------|
| **TN company** | Client company `Noble Express Courier Services Ltd` in Accountant View | Yes for company-scoped OpsWatch connection / companyId on repairs |
| **OpsWatch connector** | Integrations → **OpsWatch** (not Arez) on that company | Yes if allowlisting via `integrationConnection.configJson.opsWatchProjectId` |
| **Remediator env + OW project link** | TN `OPSWATCH_REMEDIATOR_*` + OpsWatch project `app-noble-express` Worker remediator webhook | **Required** for Fix→recover |

Arez (visible on Integrations) is unrelated to live-heal.

## Already present (this machine)

- OpsWatch project `app-noble-express` (`slug: noble-express`) with Worker remediator integration (`TrueNumeris Worker Remediator`, `VALID`).
- TN remediator code: `/api/internal/opswatch/remediator` (+ health).
- Local seed: company `NOBLE-EXPRESS`, OpsWatch `integrationConnection` with `opsWatchProjectId=app-noble-express`, and `OPSWATCH_REMEDIATOR_*` in TN `server/.env`.

## Reproduce (local)

```powershell
# OpsWatch API already on :4000. Mock :8791 may stay up but is unused.

# Prefer full TN briefly; if health does not answer in ~25s, use remediator-only:
cd "C:\Users\edwar\OneDrive\My Project\TrueNumeris\server"
$env:PORT='4100'
node --import tsx "C:/Users/edwar/Documents/Projects/opswatch/test-artifacts/tn-remediator-only-server.mjs"

# Seed / refresh company + connection + remediator env (idempotent; does not print secrets)
node C:\Users\edwar\Documents\Projects\opswatch\test-artifacts\seed-noble-tn-local.cjs

# Proof (loads TN webhook secret from TN server/.env when LIVE_HEAL_REMEDIATOR_SECRET unset)
cd C:\Users\edwar\Documents\Projects\opswatch
$env:LIVE_HEAL_REMEDIATOR_URL='http://127.0.0.1:4100/api/internal/opswatch/remediator'
$env:LIVE_HEAL_PROJECT_SLUG='noble-express'
pnpm exec tsx scripts/prove-live-heal-local.ts
```

Health check: `GET http://127.0.0.1:4100/api/internal/opswatch/remediator/health` → `role: truenumeris-opswatch-remediator`.

## Cloud / TN UI (if using hosted app.truenumeris.com)

If the company already appears in Accountant View:

1. Stay on **Noble Express Courier Services Ltd**.
2. **Integrations** → create **OpsWatch** (skip Arez unless you need job sync).
3. Open **OpsWatch Setup** (`/dashboard/settings/integrations/opswatch`):
   - OpsWatch Base URL (prod: `https://opswatch.okanggroup.com/api`)
   - Paste OpsWatch API key + signing secret from OpsWatch Connect
   - Project name/slug: prefer `Noble Express` / `noble-express` if monitoring Noble; or `TrueNumeris` / `truenumeris` if monitoring TN itself
   - Save → **Register / Sync with OpsWatch**
4. Server ops (not UI): set `OPSWATCH_REMEDIATOR_WEBHOOK_SECRET` and `OPSWATCH_REMEDIATOR_PROJECT_ID=app-noble-express` on the TN host, then point OpsWatch remediator webhook at TN’s `/api/internal/opswatch/remediator` with the **same** secret.

Do not push either repo until explicitly asked.
