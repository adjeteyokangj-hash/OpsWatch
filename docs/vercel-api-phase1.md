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
   - **Output Directory:** leave **blank** (clear any override such as `public`, `dist`, or `.vercel/output`)
5. Deploy after env vars are set (step 2)

**Build log must show** `@opswatch/api vercel-build`, `prisma generate`, `tsc`.  
**Must not show** `@opswatch/web build`, `next build`, or `No Output Directory named "public"`.

If Vercel reports **No Output Directory named "public" found**, the dashboard still has **Output Directory** set to `public`. Clear it completely — this API uses `apps/api/api/index.ts` as a serverless function and does not produce static output.

## 2. API environment variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase **transaction pooler** (port **6543**, `?pgbouncer=true`) — runtime |
| `DIRECT_URL` | Supabase **session pooler** (port **5432** on `*.pooler.supabase.com`) — migrations only |
| `JWT_SECRET` | Auth signing (≥32 chars, production-only value) |
| `WORKER_INTERNAL_SECRET` | Secured internal routes (≥16 chars) |
| `OPSWATCH_WEB_URL` | `https://opswatch.okanggroup.com` |
| `NODE_ENV` | `production` |
| `SEED_ADMIN_PASSWORD` | Required if running seed in production |
| `SMTP_*` | Optional email delivery |
| `OPENAI_API_KEY` | Optional; only if LLM features enabled |
| Integration/webhook secrets | As used by your deployment |

### Supabase connection strings (important)

Vercel often **cannot reach** `db.<ref>.supabase.co:5432` (P1001). Use the **pooler** hostnames from Supabase → Project Settings → Database:

| Variable | Supabase UI | Example shape |
|----------|-------------|---------------|
| `DATABASE_URL` | **Transaction pooler** → URI | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | **Session pooler** → URI (port 5432) | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres` |

Do **not** use `db.<ref>.supabase.co` for `DATABASE_URL` or Vercel runtime on the free tier unless you have Supabase IPv4 add-on.

Also confirm the Supabase project is **not paused** (Dashboard → project status).

## 3. Build behaviour

`apps/api/vercel.json` runs `pnpm vercel-build`, which:

1. Builds `@opswatch/shared`
2. `prisma generate`
3. `tsc` compile

**Migrations are not run during Vercel build** (avoids P1001/network failures and is safer for production). Run once before or after first deploy:

```bash
cd apps/api
# Use DIRECT_URL / session pooler from your machine or CI
pnpm db:migrate
```

Optional one-off with migrate in build: `pnpm vercel-build:migrate` (only after pooler URLs are verified).

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
