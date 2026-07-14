# Onboard StarLiz & TrueNumeris to OpsWatch

**Status:** Client wiring implemented locally (14 Jul 2026). **Not live** until you create OpsWatch projects, paste Connect credentials into each app, migrate/deploy, and push (when you choose).

**Nothing in this checklist requires pushing OpsWatch, StarLiz, or TrueNumeris.** Adapter work stays local until you ask to ship.

Canonical production ingest base (as used by Noble Express):

`https://opswatch.okanggroup.com/api`

Always paste the **project slug** from OpsWatch Connect (e.g. `starliz-academy`, `truenumeris`) — never the display Application ID (`OW-APP-…`).

Reference implementation: Noble Express Integration Centre + signed heartbeats (`Noble Express Courier/noble-express-platform` → `src/lib/opswatch-integration.ts`, cron `/api/internal/jobs/opswatch-heartbeat`).

---

## 1. Codebase inventory (discovered locally)

| App | Local path | Remote | Deploy / public URLs | OpsWatch readiness |
|-----|------------|--------|----------------------|--------------------|
| **StarLiz Academy** (primary “StarLiz”) | `C:\Users\edwar\Documents\Projects\starliz-academy` | `https://github.com/adjeteyokangj-hash/starliz-academy.git` | Production docs/tests use `https://www.starlizacademy.com` / `https://starlizacademy.com`; Vercel project `starliz-academy` | **Wired locally.** Admin → Integrations → OpsWatch (`/admin/integrations/opswatch`); signed heartbeat lib; cron `POST/GET /api/cron/opswatch-heartbeat`; Prisma `OpsWatchIntegration` + migration. Needs migrate + credentials + deploy. |
| **Starliz Guitar** (sister product) | `C:\Users\edwar\Documents\Projects\Starliz Guitar` | **No git remote** | Unknown / not production-tracked here | **Deferred.** |
| **TrueNumeris** | `C:\Users\edwar\OneDrive\My Project\TrueNumeris` | `https://github.com/adjeteyokangj-hash/TrueNumeris.git` | API `https://api.truenumeris.com`; app `https://app.truenumeris.com` | **Wired locally.** Default base URL fixed to `opswatch.okanggroup.com/api`; signing secret + project slug fields; signed `/heartbeat` on register/test when secret present; register paths aligned to `/api` base. Needs credentials + deploy. |

---

## 2. Recommended order

1. **StarLiz Academy first** — Integration Centre + signed heartbeats (done locally).
2. **TrueNumeris second** — base URL + register + optional heartbeats (done locally).

---

## 3. Shared OpsWatch prep (both apps)

Do this in production OpsWatch (`https://opswatch.okanggroup.com`):

1. Sign in as org owner / Super Admin with access to the target org.
2. **Register application** wizard → name `StarLiz Academy` / `TrueNumeris`.
3. Copy Connect credentials exactly once:
   - Base URL: `https://opswatch.okanggroup.com/api`
   - API key
   - Signing secret
   - **Project slug**
4. Confirm ingest is reachable from the app host.
5. Optional: notification channel + SLO after first healthy signals.

Env shape (fallback when no in-app settings):

```bash
OPSWATCH_API_URL=https://opswatch.okanggroup.com/api
OPSWATCH_API_KEY=...
OPSWATCH_SIGNING_SECRET=...
OPSWATCH_PROJECT_SLUG=starliz-academy   # or truenumeris
```

---

## 4. StarLiz Academy checklist

### A. Create OpsWatch project + credentials

- [ ] Register `StarLiz Academy` → slug e.g. `starliz-academy`
- [ ] Save API key + signing secret + slug offline
- [ ] Public URL (optional on project): `https://www.starlizacademy.com`

### B. Wire credentials (prefer in-app)

- [x] OpsWatch card under Admin → Integrations (`/admin/integrations/opswatch`)
- [x] Stores base URL, API key, signing secret, project slug (encrypted)
- [x] Test Connection = one signed heartbeat
- [x] Fallback: `OPSWATCH_*` env vars
- [ ] Run Prisma migrate for `OpsWatchIntegration` (local + production when deploying)
- [ ] Paste Connect credentials in Admin UI (or set env) after project exists
- [ ] Push/deploy StarLiz when ready (user-triggered only)

### C. Heartbeat path

- [x] Route: `POST/GET /api/cron/opswatch-heartbeat` protected by `CRON_SECRET`
- [ ] Enable scheduled invoke (Vercel Cron or external ping) — prefer **every 5 minutes**
- [ ] **Blocker awareness:** Vercel Hobby crons are often **daily only** — same issue as Noble

### D. Service / topology seed

- [x] OpsWatch seed: `scripts/lib/starliz-academy-graph.seed.ts` + `pnpm monitoring:seed-starliz-academy`
- [ ] Create project in OpsWatch first, then run seed with `STARLIZ_ACADEMY_PROJECT_SLUG=starliz-academy`
- [ ] Until seed: wizard Discover + HTTP check on `https://www.starlizacademy.com/api/health`

### E. Verification

- [ ] `GET https://www.starlizacademy.com/api/health` → 200
- [ ] Test Connection / heartbeat appears on OpsWatch overview
- [ ] Topology / services populated
- [ ] Optional: induce stale heartbeat / HTTP fail → alert → recovery

---

## 5. TrueNumeris checklist

### A. Create OpsWatch project + credentials

- [ ] Register `TrueNumeris` → slug e.g. `truenumeris` **or** let register endpoint create/reuse when using org API key with `events:write`
- [ ] Prefer wizard credentials so key/secret match Connect UX
- [x] OpsWatch route confirmed locally: `POST /api/truenumeris/register`

### B. Wire Integration Centre

- [x] Default base URL → `https://opswatch.okanggroup.com/api` (legacy `api.opswatch.io` coerced away)
- [x] Signing secret + project slug fields in Admin + dashboard UI
- [x] Register paths use `/truenumeris/register` relative to `/api` base (no double `/api`)
- [ ] Open `/admin/settings/integrations/opswatch`, select company, paste credentials
- [ ] Set health URLs (typical):

  | Field | Suggested value |
  |-------|-----------------|
  | Admin portal | `https://admin.truenumeris.com` (or actual admin host) |
  | Customer portal | `https://app.truenumeris.com` |
  | Backend health | `https://api.truenumeris.com/api/health` |

- [ ] Enable → Test Health → Register / Sync
- [ ] Push/deploy TrueNumeris when ready (user-triggered only)

### C. Heartbeat path

- [x] Signed `POST /heartbeat` when signing secret + project slug stored (on Test Health / Register-Sync)
- [ ] Prefer recurring job on Render (or cron) for 5‑minute freshness; HTTP checks from register remain primary path today

### D. Service / topology seed

- [x] Register endpoint creates Admin / Customer / Backend services + HTTP checks
- [ ] Optional richer graph later (`truenumeris-graph.seed.ts`) — not blocking first connect

### E. Verification

- [ ] `GET https://api.truenumeris.com/api/health` → 200
- [ ] Register/sync ok against `https://opswatch.okanggroup.com/api/truenumeris/register`
- [ ] OpsWatch shows three services + HTTP checks
- [ ] If signing secret set: heartbeat accepted and freshness updates

---

## 6. Adapter stubs

| Repo | Status |
|------|--------|
| StarLiz Academy | **Implemented locally** (Integration Centre + cron + migration) |
| Starliz Guitar | Deferred |
| TrueNumeris | **Implemented locally** (URL fix + signing secret + heartbeat) |

---

## 7. Blockers & risks

| Blocker | Who | Notes |
|---------|-----|-------|
| Credentials not created yet | Operator | Must use OpsWatch wizard — do not invent keys |
| Prisma migrate not applied (StarLiz) | StarLiz deploy | Migration `20260714180000_add_opswatch_integration` |
| Hobby cron limits | StarLiz (Vercel) | Daily cron ≠ 5‑min heartbeat |
| Push / Vercel cost | Operator | **Do not push until ready** |
| Guitar unfinished / no remote | Starliz Guitar | Defer |

---

## 8. Next manual steps (operator)

1. **OpsWatch** (browser): Register **StarLiz Academy** → copy slug/key/secret. Optionally run `pnpm monitoring:seed-starliz-academy` after project exists (needs DB URL + slug env). Push OpsWatch seed script only when you want it on the OpsWatch remote.
2. **StarLiz** (after local migrate): apply `OpsWatchIntegration` migration; open `/admin/integrations/opswatch`; paste credentials; Test Connection; then **push/deploy when you say so**; schedule cron.
3. **OpsWatch**: Register **TrueNumeris** (or register via TN sync with org `events:write` key).
4. **TrueNumeris**: deploy when ready; Admin → OpsWatch; set base URL / key / signing secret / slug / three health URLs; Register/Sync.
5. Verify both projects leave “Waiting for first heartbeat” / UNKNOWN on OpsWatch.

**Deferral:** No GitHub / Vercel push from the agent unless you explicitly ask.
