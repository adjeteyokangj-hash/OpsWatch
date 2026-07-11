# OpsWatch API — Vercel Phase 1 (production access)

Restore login and API access using **Vercel (API) + Supabase (database)**. Do not deploy worker cron routes in this phase.

## Architecture

| Layer | Host |
|-------|------|
| Web | Vercel project `opswatch-production` |
| API | **Separate** Vercel project (root: `apps/api`) |
| Database | Supabase Postgres |

## 1. Create the Vercel API project

1. Vercel → **Add New Project** → import `adjeteyokangj-hash/OpsWatch`
2. **Root Directory:** `apps/api`
3. **Framework Preset:** Other (repo `apps/api/vercel.json` sets `"framework": null`)
4. **Override dashboard settings** if they conflict with the repo file:
   - **Install Command:** `cd ../.. && pnpm install --prod=false`
   - **Build Command:** `cd ../.. && pnpm --filter @opswatch/api vercel-build`
   - **Output Directory:** leave blank
5. Deploy after env vars are set (step 2)

**Build log must show** `@opswatch/api vercel-build`, `prisma generate`, `prisma migrate deploy`, `tsc`.  
**Must not show** `@opswatch/web build` or `next build`.

## 2. API environment variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase **transaction pooler** URI (runtime) |
| `DIRECT_URL` | Supabase **direct** URI (migrations at build) |
| `JWT_SECRET` | Auth signing (≥32 chars, production-only value) |
| `WORKER_INTERNAL_SECRET` | Secured internal routes (≥16 chars) |
| `OPSWATCH_WEB_URL` | `https://opswatch.okanggroup.com` |
| `NODE_ENV` | `production` |
| `SEED_ADMIN_PASSWORD` | Required if running seed in production |
| `SMTP_*` | Optional email delivery |
| `OPENAI_API_KEY` | Optional; only if LLM features enabled |
| Integration/webhook secrets | As used by your deployment |

**Supabase connection strings**

- `DATABASE_URL`: Project Settings → Database → Connection string → **URI** → **Transaction pooler**
- `DIRECT_URL`: Same page → **Direct connection** (port 5432)

## 3. Build behaviour

`apps/api/vercel.json` runs `pnpm vercel-build`, which:

1. Builds `@opswatch/shared`
2. `prisma generate`
3. `prisma migrate deploy` (uses `DIRECT_URL` via schema)
4. `tsc` compile

Serverless entry: `apps/api/api/index.ts` exports the Express `app` (no `listen()`).

Local long-running server: `pnpm --filter @opswatch/api dev` → `src/server.ts`.

## 4. Web project update

On Vercel **web** project (`opswatch-production`):

```
NEXT_PUBLIC_OPSWATCH_API_URL=https://YOUR-API-PROJECT.vercel.app/api
```

Remove unused legacy vars if present:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_API_BASE_URL`

Redeploy the web project after updating.

## 5. Phase 1 verification checklist

Replace `API` with your Vercel API URL.

| Check | Command / action |
|-------|------------------|
| Health | `curl https://API/api/health` |
| Liveness | `curl https://API/api/health/live` |
| Readiness | `curl https://API/api/health/ready` |
| CORS | `curl -i -X OPTIONS https://API/api/auth/login -H "Origin: https://opswatch.okanggroup.com" -H "Access-Control-Request-Method: POST"` |
| Login | Sign in at `https://opswatch.okanggroup.com/login` |
| Org/projects | Dashboard loads projects |
| Billing/settings | Open project billing and settings tabs |
| Mutations | Create or update a non-destructive resource |

## 6. Not in Phase 1

- Worker / Vercel Cron job routes
- AI Brain implementation
- Railway services (decommission after Phase 1 passes)

Phase 2 adds idempotent `/api/internal/cron/*` routes and Vercel Cron (Pro for frequent schedules).
