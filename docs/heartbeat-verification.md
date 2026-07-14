# Heartbeat verification (OpsWatch)

Local/operator guide for signed client heartbeats. This document covers **OpsWatch** only (ingest, freshness, alerts). Client-app wiring for StarLiz/TrueNumeris stays in their own repos and onboard checklist.

## Recommended cadence

| Setting | Value | Where |
|---------|-------|--------|
| Client send interval | **Every 5 minutes** | Client cron / Integration Centre / external scheduler |
| OpsWatch stale → MEDIUM | **≥ 10 minutes** since last heartbeat | Worker `process-heartbeat-stale` |
| OpsWatch stale → HIGH | **≥ 20 minutes** since last heartbeat | Worker `process-heartbeat-stale` |
| Stale job poll | Default **60s** (`WORKER_HEARTBEAT_STALE_INTERVAL_MS`) | Worker scheduler |
| Ingest timestamp window | Default **300s** (`INGEST_TIMESTAMP_WINDOW_SECONDS`) | API ingest middleware |

Use a steady 5‑minute pulse so a single missed beat becomes MEDIUM (~10m), and two misses reach HIGH (~20m).

## Status behaviour

| Situation | Project / UI behaviour |
|-----------|------------------------|
| Never received a heartbeat | Status **UNKNOWN**; label **“Waiting for first heartbeat”** |
| Healthy heartbeat (`status` not `DOWN`) | Project marked **HEALTHY**; open HEARTBEAT alerts resolved |
| Heartbeat body `status: "DOWN"` | Project **DOWN**; HIGH alert “Heartbeat reports DOWN” |
| Last heartbeat 10–20 minutes old | Project **DEGRADED**; open/update alert “Heartbeat stale” (MEDIUM) |
| Last heartbeat ≥ 20 minutes old | Project **DEGRADED**; “Heartbeat stale” severity HIGH |
| Fresh heartbeat after stale window | Project **HEALTHY**; stale alerts resolved |
| Delayed but still within ingest window | Accepted if signature + nonce valid and timestamp age ≤ window |
| Timestamp older than window | **401** `INGEST_STALE` — fix clock skew / retry with fresh headers |
| Replay / reused nonce | **401** replay rejection |

Degraded/unknown health on apps may also come from failed checks or open incidents; heartbeat staleness is one input, not the only one.

## Signing, secrets, headers

Required when `INGEST_SIGNING_REQUIRED` is not `"false"` (production default: required):

1. Authenticate with project ingest API key (`events:write` / `heartbeats:write` scopes as issued).
2. Body must include `projectSlug` (the real slug — never the `OW-APP-…` display id).
3. Headers (names from API constants):
   - Timestamp header
   - Nonce header (unique per request)
   - HMAC signature header over timestamp + nonce + raw body using the project **signing secret**

Store API key and signing secret only in the client’s secret store / Integration Centre — never commit them.

## Hobby cron limits (Vercel)

Vercel **Hobby** cron is typically limited to about **one run per day**. That is far below the 5‑minute heartbeat cadence and will leave apps in **UNKNOWN** or stale **DEGRADED**.

Options:

- Upgrade to a plan that allows frequent cron, **or**
- Drive heartbeats from an **external scheduler** (GitHub Actions schedule, Render cron, Pingdom/Uptime Robot calling your client’s heartbeat route, Railway, etc.) protected by `CRON_SECRET` (or equivalent) on the client route.

OpsWatch itself does not invent heartbeats; without a real client pulse, waiting/unknown/stale states are correct.

## External scheduler checklist

- [ ] Schedule `GET`/`POST` of the client OpsWatch heartbeat job about every **5 minutes**
- [ ] Pass client `CRON_SECRET` (or signed auth) so the route is not public
- [ ] Confirm OpsWatch shows leaving “Waiting for first heartbeat”
- [ ] Confirm topology / overview last-seen updates
- [ ] Optionally pause client for &gt;10 minutes and confirm **Heartbeat stale** alert, then restore and confirm resolve

## Local verification (additive; no production migrate)

```bash
# API + worker must be running against local Postgres
pnpm --filter @opswatch/api exec prisma migrate status
# Register app in UI → Connect credentials → send signed heartbeat from client or demo script
# Watch project leave UNKNOWN; worker path processes stale ages as above
```

Do **not** run production migration or push from this checklist alone.
