# Production Hardening Baseline

## Secrets

- Rotate `JWT_SECRET` before production launch.
- Do not keep default seed credentials in production.
- Store SMTP/API secrets in secret manager, not `.env` committed files.

## CORS and Auth

- Keep `NODE_ENV=production` so API only trusts configured `OPSWATCH_WEB_URL`.
- **Webhook ingress:** `/api/webhooks/*` rejects unsigned requests. Provider secrets must be configured; missing secrets return 503 (fail-closed). Signatures are verified against raw request bytes with constant-time comparison.
- **Not yet implemented:** ingest endpoints do not currently enforce key + timestamp + HMAC signature (API key scope only). Do not claim replay protection until implemented and tested.
- Reject stale timestamps and invalid signatures (planned — see production-gate-report.md release blockers).

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
- Web: route smoke checks from `pnpm quarantine:dashboard-smoke`

## Notification Safety

- Keep at least one active notification channel configured.
- Alert triggers should notify on `triggered` and `resolved` transitions.
- Monitor notification delivery failures in worker logs.
