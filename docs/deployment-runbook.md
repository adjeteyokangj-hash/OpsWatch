# Deployment Runbook

## Target Services

- API
- Web dashboard
- Worker
- PostgreSQL

## Required Environment Variables

- `DATABASE_URL`
- `JWT_SECRET`
- `OPSWATCH_WEB_URL`
- `OPSWATCH_API_URL`
- `SMTP_HOST` (optional)
- `SMTP_PORT` (optional)
- `SMTP_USER` (optional)
- `SMTP_PASS` (optional)
- `SMTP_FROM` (optional)

## Pre-Deploy Commands

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @opswatch/web test
pnpm -r lint
pnpm --filter @opswatch/api db:generate
pnpm --filter @opswatch/api db:migrate
pnpm --filter @opswatch/api db:seed
```

## API Deploy

```bash
pnpm --filter @opswatch/api build
pnpm --filter @opswatch/api start
```

## Web Deploy

```bash
pnpm --filter @opswatch/web build
pnpm --filter @opswatch/web start
```

## Worker Deploy

```bash
pnpm --filter @opswatch/worker build
pnpm --filter @opswatch/worker dev
```

Use a supervisor in production (`systemd`, PM2, Docker restart policy, or Kubernetes restart policy).

## Post-Deploy Verification

```bash
pnpm verify:monitoring
pnpm notify:webhook-listener
pnpm verify:notifications
pnpm dashboard:smoke
```

## Domain and HTTPS

- Web: map `OPSWATCH_WEB_URL` to production domain via HTTPS
- API: map `OPSWATCH_API_URL` to production domain via HTTPS
- Use trusted TLS certs (managed cert manager recommended)
- Ensure reverse proxy forwards headers and supports Web/API CORS configuration
