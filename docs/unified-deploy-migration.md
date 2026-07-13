# Unified deploy (Noble model)

OpsWatch is moving from **two Vercel projects** (web + API) to **one Next.js app** like Noble Express.

## Target architecture

| | Before | After (Noble model) |
|---|---|---|
| Vercel projects | `opswatch-production` + `ops-watch-api` | **One** (`opswatch-production`) |
| `/api/*` | Proxy to external Express | **Express in-process** in Next.js |
| Env vars | Split across web + API projects | **All on web project** |
| Session cookies | Same-origin proxy (fragile) | **Native same-origin** |
| Deploy | Push + 2 deploys + env sync | **Push + 1 deploy** |
| Migrations | Manual on API | `vercel-build` runs `prisma generate` (migrate still manual or CI) |

Worker/background jobs stay separate for now (Phase 2: Vercel Cron like Noble's `/api/internal/jobs/*`).

## Phase 1 (implemented)

- `apps/web/src/server/opswatch-api-handler.ts` — runs Express in-process
- `apps/web/src/app/api/[...path]/route.ts` — embedded by default; proxy only if `OPSWATCH_API_ORIGIN` is set
- `vercel.json` — `pnpm --filter @opswatch/web vercel-build` (shared build + prisma generate + next build)
- Local `pnpm dev` unchanged — set `OPSWATCH_API_ORIGIN=http://127.0.0.1:4000` for split dev

## Production cutover checklist

### 0. Export API secrets first (do this before anything else)

Vercel **does not show secret values** after you save them. Before you change or retire `ops-watch-api`, pull a local copy:

```bash
# From a throwaway folder, link to the API project (ops-watch-api), then:
npx vercel env pull .env.api.production --environment=production
```

Keep `.env.api.production` **off git** (local only). Use it as the source when pasting into the web project.

If you already cannot reveal values in either project, rebuild from sources of truth instead:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase → Project Settings → Database |
| `STRIPE_*` | Stripe Dashboard → Developers → API keys / Products / Webhooks |
| `JWT_SECRET`, `WORKER_INTERNAL_SECRET`, `OPSWATCH_SECRETS_ENCRYPTION_KEY` | Password manager / prior export — **do not rotate** unless you plan a forced re-login / secret re-encrypt |
| `PLATFORM_SUPER_ADMIN_EMAILS` | Known: `admin@okanggroup.com` |
| Webhook secrets (`VERCEL_`, `GITHUB_`, `RENDER_`, `STRIPE_WEBHOOK_SECRET`) | Provider dashboards (may need regenerate + update) |

### 1–7. Cutover

1. **Copy env vars** from the pull file (or table above) onto `opswatch-production`  
   (`DATABASE_URL`, `JWT_SECRET`, `PLATFORM_SUPER_ADMIN_EMAILS`, `STRIPE_*`, etc.)
2. **Remove** `OPSWATCH_API_ORIGIN` from web project (enables embedded API)
3. **Remove** `NEXT_PUBLIC_OPSWATCH_API_URL` if it points at external API URL — use `/api`
4. Deploy **web only** from latest `main`
5. Run `pnpm db:migrate` against production Supabase (once)
6. Sign out / sign in on production
7. **Decommission** separate `ops-watch-api` Vercel project (optional after verification)

## Phase 2 (future)

- Migrate Express routes to native Next.js `route.ts` handlers (like Noble's ~195 routes)
- Vercel Cron for checks/retention instead of standalone worker
- Single `prisma/` at repo root (optional cleanup)

## Phase 3 (future)

- Retire standalone `apps/api` dev server for local dev — `next dev` only
