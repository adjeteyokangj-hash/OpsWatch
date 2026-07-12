# Production Hardening Baseline

## Secrets

- Rotate `JWT_SECRET` before production launch.
- Do not keep default seed credentials in production.
- Store SMTP/API secrets in secret manager, not `.env` committed files.

## CORS and Auth

- Keep `NODE_ENV=production` so API only trusts configured `OPSWATCH_WEB_URL`.
- **Webhook ingress:** `/api/webhooks/*` rejects unsigned requests. Provider secrets must be configured; missing secrets return 503 (fail-closed). Signatures are verified against raw request bytes with constant-time comparison.
- **Ingest replay protection:** `/api/event`, `/api/health-snapshot`, and `/api/heartbeat` require API key scope plus signed timestamp, nonce, and HMAC over raw body bytes. Missing project signing configuration returns 503. Replayed nonces return 409. Stale timestamps return 401 with `INGEST_STALE`.
- **Browser sessions:** Authentication uses server-managed sessions in HttpOnly cookies (`opswatch_session`) with CSRF double-submit (`opswatch_csrf` + `x-opswatch-csrf`). Session secrets are stored hashed in PostgreSQL (`tokenHash`, `csrfTokenHash`); raw tokens exist only in cookies. Production sets `Secure` cookies. `SESSION_SIGNING_REQUIRED=true` (default) enables cookie authentication; set `false` only for local bearer-token testing. Next.js middleware treats the session cookie as an access hint; the API is authoritative for validity, expiry, and revocation. Password changes, admin resets, role changes, and deactivation revoke existing sessions.
- Reject stale timestamps and invalid signatures on ingest routes (enforced — see ingest replay protection above).

## CI and Release Verification

- Primary workflow (`.github/workflows/ci.yml`) runs on `main` and pull requests: lint, typecheck, sequential package tests (`RUN_DATABASE_E2E=true`), build, and Playwright browser E2E against a seeded Postgres 16 service.
- Do not treat the production gate as closed until CI is required on the protected branch and at least one clean run is recorded after the session and CI commits land.

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
