# Production Hardening Baseline

## Secrets

- Rotate `JWT_SECRET` before production launch.
- Do not keep default seed credentials in production.
- Store SMTP/API secrets in secret manager, not `.env` committed files.

## CORS and Auth

- Keep `NODE_ENV=production` so API only trusts configured `OPSWATCH_WEB_URL`.
- Verify ingest endpoints require key + timestamp + signature.
- Reject stale timestamps and invalid signatures.

## Logging Safety

- Do not log request bodies containing secrets.
- Do not surface API keys/signing secrets in UI payloads.
- Keep error logs concise and avoid dumping full env config.

## Worker Reliability

- Worker now handles `SIGINT` and `SIGTERM` clean shutdown.
- Worker logs liveness heartbeat every minute.
- Worker exits non-zero on uncaught exception for supervisor restart.

## Health Checks

- API: `/api/health`
- Worker: process supervisor should alert on restart loops
- Web: route smoke checks from `pnpm dashboard:smoke`

## Notification Safety

- Keep at least one active notification channel configured.
- Alert triggers should notify on `triggered` and `resolved` transitions.
- Monitor notification delivery failures in worker logs.
