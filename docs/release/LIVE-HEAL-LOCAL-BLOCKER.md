# Local live-heal blocker (2026-07-16)

**Status: BLOCKED** — Fix→recover was **not** proven locally for Noble/TrueNumeris.

## Why

- Stack down: only Postgres `:5432` listening; API (`:4000`), web (`:3000`), Redis (`:6379`), mock remediator (`:8791`) not running.
- Remediator wiring missing in local env: no `REMEDIATOR*`, `NOBLE*`, `TRUE*`, or `OPSWATCH_SECRETS_ENCRYPTION_KEY` in `apps/api/.env` / `apps/worker/.env` / `.env.local`.
- No local evidence of a remediator repair `COMPLETED` / accepted for an external app.

## Not a substitute

Unit suite `remediator-provider.service.test.ts` (20/20) proves signing/gates with mocks only — **not** live Fix→recover.

## Unblock checklist (local)

1. Start API + worker + Redis; optionally `node scripts/mock-remediator-server.mjs`.
2. Set `OPSWATCH_SECRETS_ENCRYPTION_KEY`; configure project remediator webhook URL + secret (Noble/TN or mock).
3. Validate provider handshake, then run Fix→recover on a real incident and record attempt status.

Do not mark live-heal ready until that path succeeds against a reachable remediator.
