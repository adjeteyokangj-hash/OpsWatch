# Onboard StarLiz & TrueNumeris to OpsWatch

**Status:** Prepared only — **do not connect** until the current OpsWatch release batch is complete, pushed, and you explicitly say to wire these apps.

**Nothing in this checklist requires pushing OpsWatch, StarLiz, or TrueNumeris.** Adapter work in app repos should stay local until you ask to ship.

Canonical production ingest base (as used by Noble Express):

`https://opswatch.okanggroup.com/api`

Always paste the **project slug** from OpsWatch Connect (e.g. `starliz-academy`, `truenumeris`) — never the display Application ID (`OW-APP-…`).

Reference implementation: Noble Express Integration Centre + signed heartbeats (`Noble Express Courier/noble-express-platform` → `src/lib/opswatch-integration.ts`, cron `/api/internal/jobs/opswatch-heartbeat`).

---

## 1. Codebase inventory (discovered locally)

| App | Local path | Remote | Deploy / public URLs | OpsWatch readiness |
|-----|------------|--------|----------------------|--------------------|
| **StarLiz Academy** (primary “StarLiz”) | `C:\Users\edwar\Documents\Projects\starliz-academy` | `https://github.com/adjeteyokangj-hash/starliz-academy.git` | Production docs/tests use `https://www.starlizacademy.com` / `https://starlizacademy.com`; Vercel project `starliz-academy` | **Not wired.** No `OPSWATCH_*` code. Has `/api/health`, admin Integrations hub (TrueNumeris/Stripe/etc.), `CRON_SECRET` cron routes — **no OpsWatch Integration Centre card**. |
| **Starliz Guitar** (sister product) | `C:\Users\edwar\Documents\Projects\Starliz Guitar` | **No git remote** | Unknown / not production-tracked here | **Not wired.** Unrelated “heartbeat” means curriculum coach signals. Active unfinished polish — **defer** OpsWatch until Academy is done. |
| **TrueNumeris** (official spelling; not “Truenumris”) | `C:\Users\edwar\OneDrive\My Project\TrueNumeris` | `https://github.com/adjeteyokangj-hash/TrueNumeris.git` | API `https://api.truenumeris.com` (Render `truenumeris-api`, health `/api/health`); app `https://app.truenumeris.com`; marketing `https://truenumeris.com` | **Partial / legacy-shaped.** Admin UI at `/admin/settings/integrations/opswatch`; server routes under `/api/v1/opswatch/*`. Calls OpsWatch `POST …/api/truenumeris/register` (also aliased as `/integrations/opswatch/register`). Default base URL still `https://api.opswatch.io` — **wrong for current SaaS**. No Noble-style signed `/heartbeat` loop found. Branch noted earlier: `fix/integration-external-api-key-auth-clean`. |

**Not found under `Documents\Projects\`:** any folder named Truenumris / TrueNumris. TrueNumeris lives on OneDrive (Cursor project `…-OneDrive-My-Project-TrueNumeris`).

**Related but not the product to onboard as “TrueNumeris”:** StarLiz and Noble both *consume* TrueNumeris as a finance connector (`/admin/integrations/truenumeris`). That is outbound accounting sync — separate from monitoring TrueNumeris itself in OpsWatch. Noble’s graph seed already models `truenumeris-integration` / `truenumeris-api` as **downstream of Noble**, not as the TrueNumeris SaaS project.

---

## 2. Recommended order

1. **StarLiz Academy first** — greenfield OpsWatch client, same Next.js / Vercel pattern as Noble; clear public health URL; avoid touching unfinished Guitar polish.
2. **TrueNumeris second** — already has an Integration Centre screen and OpsWatch already exposes `/api/truenumeris/register` (creates project services + HTTP checks). Finish by correcting base URL, auth scopes, and optionally adding signed heartbeats for freshness beyond HTTP probes.

Connect **only after** you confirm the current OpsWatch batch is shipped/ready.

---

## 3. Shared OpsWatch prep (both apps)

Do this in production OpsWatch (`https://opswatch.okanggroup.com`) once the batch is live:

1. Sign in as org owner / Super Admin with access to the target org.
2. **Register application** wizard → name `StarLiz Academy` / `TrueNumeris`, environment as needed (prefer Staging first if testing).
3. Copy Connect credentials exactly once:
   - Base URL: `https://opswatch.okanggroup.com/api` (absolute; required for external apps)
   - API key
   - Signing secret (needed for heartbeat path; TrueNumeris register path today may only send `x-api-key`)
   - **Project slug**
4. Confirm ingest is reachable from the app host (not only from browser on the OpsWatch domain).
5. Optional: create notification channel (email/webhook) and an availability SLO after first healthy signals.

Env shape for apps that use env vars (fallback when no in-app Integration Centre):

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

**Preferred (Noble-like):** add an OpsWatch card under StarLiz Admin → Integrations (`/admin/settings/integrations`), storing base URL, API key, signing secret, project slug; Test Connection = one signed heartbeat.

**Fallback:** Vercel env for `OPSWATCH_*` (works, but weaker ops UX than Integration Centre).

**Do not implement until go-ahead.** When building, clone Noble’s module shapes:

| Noble piece | Suggested StarLiz home |
|-------------|------------------------|
| `src/lib/opswatch-integration.ts` | `src/lib/opswatch-integration.ts` (or under `src/lib/ops/`) |
| `POST /api/internal/jobs/opswatch-heartbeat` | `POST /api/cron/opswatch-heartbeat` protected by `CRON_SECRET` |
| Integration Centre form | Card on `/admin/settings/integrations` + settings API |
| Optional probe | reuse `/api/health` as HTTP check target in OpsWatch |

Signing: HMAC-SHA256 over `${timestamp}.${nonce}.${body}` with headers `x-api-key`, `x-opswatch-timestamp`, `x-opswatch-nonce`, `x-opswatch-signature`, `x-opswatch-environment` → `POST {base}/heartbeat` with `projectSlug` in body (see `@opswatch/client` and Noble).

### C. Heartbeat path

- [ ] Enable scheduled invoke of heartbeat route (Vercel Cron or external scheduler)
- [ ] Target interval: **every 5 minutes** per `docs/monitoring-standards.md` (stale alerts at ~10 / 20 min)
- [ ] **Blocker awareness:** Vercel Hobby crons are often **daily only**. Noble currently schedules OpsWatch heartbeat at `0 3 * * *` (once/day) — insufficient for 5‑minute freshness. Prefer Pro cron, external ping, or OpsWatch worker-side checks until cadence is fixed.

### D. Service / topology seed

- [ ] After project exists, add a StarLiz graph seed in OpsWatch (clone `scripts/lib/noble-express-graph.seed.ts` → e.g. `scripts/lib/starliz-academy-graph.seed.ts` + `pnpm monitoring:seed-starliz-academy`)
- [ ] Suggested starter layers: APP `starliz-academy`; MODULEs (learning, billing, admin, integrations); WORFLOWs (assignment loop, parent portal, TrueNumeris sync); COMPONENTs (`/api/health`, Postgres, cron jobs, media/S3)
- [ ] Stable IDs e.g. `svc-sa-*`, `dep-sa-*`; require project slug env `STARLIZ_ACADEMY_PROJECT_SLUG`

Until the seed exists, wizard Discover + manual HTTP check against `https://www.starlizacademy.com/api/health` is enough for first connect.

### E. Verification

- [ ] `GET https://www.starlizacademy.com/api/health` → 200 when healthy
- [ ] Test Connection / first heartbeat appears on OpsWatch project overview (not stuck “Waiting for first heartbeat”)
- [ ] Topology / services populated (seed or register discovery)
- [ ] Optional: induce stale heartbeat / HTTP fail and confirm alert → recovery

---

## 5. TrueNumeris checklist

### A. Create OpsWatch project + credentials

- [ ] Register `TrueNumeris` → slug e.g. `truenumeris` **or** let register endpoint create/reuse project when using org API key with `events:write`
- [ ] Prefer wizard credentials so ingest key/secret match Connect UX used by Noble
- [ ] Confirm OpsWatch route is live: `POST /api/truenumeris/register` (mounted in `apps/api`)

### B. Wire Integration Centre (already present)

In TrueNumeris Admin Console:

1. Open **`/admin/settings/integrations/opswatch`**
2. Select company
3. Set **OpsWatch Base URL** to `https://opswatch.okanggroup.com/api` (replace default `https://api.opswatch.io`)
4. Paste OpsWatch API key
5. Set Admin / Customer / Backend health URLs — typical:

   | Field | Suggested value |
   |-------|-----------------|
   | Admin portal | `https://admin.truenumeris.com` (or wherever admin is hosted) |
   | Customer portal | `https://app.truenumeris.com` |
   | Backend health | `https://api.truenumeris.com/api/health` |

6. Enable connection → **Test Health** → **Register / Sync with OpsWatch**

Register creates/updates OpsWatch services + **HTTP checks (60s)** for those three URLs — this is TrueNumeris’s primary path today (not Noble’s generic heartbeat).

### C. Heartbeat path (gap)

- [ ] Today `lastHeartbeatAt` updates on local save; outbound traffic is register/health against `/api/truenumeris/register`, **not** signed `POST /heartbeat`
- [ ] After batch ships, decide: (1) rely on HTTP checks from register, and/or (2) add Noble-style signed heartbeats so overview freshness matches monitoring standards
- [ ] If adding heartbeats: store **signing secret** in OpsWatch connection UI (field missing vs Noble), cron on Render or in-process job

### D. Service / topology seed

- [ ] Register endpoint already creates Admin Portal / Customer Portal / Backend API services + HTTP checks
- [ ] For richer topology (finance modules, bank feeds, HMRC, integration webhooks), clone Noble seed pattern: `scripts/lib/truenumeris-graph.seed.ts` with prefix `tn`, slug env `TRUENUMERIS_PROJECT_SLUG`
- [ ] Do **not** confuse with Noble’s embedded `truenumeris-api` component — that edges Noble → TN; TrueNumeris project graph is the TN platform itself

### E. Verification

- [ ] `GET https://api.truenumeris.com/api/health` → 200
- [ ] Register/sync returns `ok` against `https://opswatch.okanggroup.com/api/truenumeris/register`
- [ ] OpsWatch project shows three services + active HTTP checks
- [ ] Worker runs checks; overview leaves UNKNOWN
- [ ] If heartbeats added: signed heartbeat accepted and timestamp fresh

---

## 6. Adapter stubs

**Not added in this prep pass.**

| Repo | Why |
|------|-----|
| StarLiz Academy | Needs a deliberate Integration Centre + cron design; Academy has local uncommitted/game work — document before coding |
| Starliz Guitar | Unfinished polish, no remote — out of scope |
| TrueNumeris | Integration UI already exists; risk is **protocol/default URL alignment**, not a missing stub | When you authorize implementation: StarLiz = port Noble `opswatch-integration.ts` + cron; TrueNumeris = fix base URL default + optional signed heartbeat + optional signing-secret field.

---

## 7. Blockers & risks

| Blocker | Who | Notes |
|---------|-----|-------|
| OpsWatch batch not shipped | OpsWatch | **Gate:** no production connect until you say the batch is complete / pushed / ready |
| Wrong OpsWatch host | TrueNumeris | Default `https://api.opswatch.io` will fail against Okang SaaS |
| Auth / scopes | TrueNumeris ↔ OpsWatch | Register requires API key with `events:write`; TN health/register calls only send `x-api-key` (no HMAC today) |
| No Integration Centre for OpsWatch | StarLiz | Must build UI or use env |
| Hobby cron limits | StarLiz (Vercel) | Daily cron ≠ 5‑min heartbeat; same issue already present on Noble |
| Signing secret unused | TrueNumeris | Overview may stay “fresh” only via HTTP checks unless heartbeat added |
| gh CLI unauthenticated | Operator | Could not list GitHub remotes via `gh`; remotes confirmed via local `git remote` |
| Guitar unfinished / no remote | Starliz Guitar | Defer |
| Confusing TN client vs TN product | All | StarLiz/Noble TrueNumeris connectors ≠ monitoring the TrueNumeris SaaS |
| GCM / org mismatch | OpsWatch | Ensure register/wizard uses the same org that owns ingest keys |
| Feature branch on TN | TrueNumeris | Local checkout has been on integration-auth branches — confirm production deploy matches Connect behavior |

---

## 8. Explicit deferral

- **No GitHub / Vercel push** from this prep.
- **No live connection** of StarLiz or TrueNumeris until you confirm the current OpsWatch release batch is complete and ask to connect.
- Optional next step when ready: implement StarLiz OpsWatch adapter (local commits first), then run TrueNumeris Integration Centre against production base URL + verify register + checks.
