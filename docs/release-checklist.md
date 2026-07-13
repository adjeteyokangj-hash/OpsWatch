# OpsWatch Release Verification Checklist

Use this checklist before every production deployment. Mark each item **Pass / Fail / N/A** and record the verifier, date, and environment.

**Release gate:** Do not deploy unless all required items pass or have an approved exception.

---

## 1. Database

- [ ] `pnpm db:migrate` applied successfully on the target environment
- [ ] `pnpm db:seed` completed (plans, entitlements, default subscriptions)
- [ ] Migration history matches `apps/api/prisma/migrations/`
- [ ] No pending schema drift (`prisma migrate status` clean)

**Commands**

```bash
pnpm db:migrate
pnpm db:seed
```

---

## 2. Services

- [ ] API restarted and healthy (`GET /api/health/live` → 200)
- [ ] API ready (`GET /api/health/ready` → 200)
- [ ] Worker restarted and processing jobs
- [ ] Web restarted and serving pages

**Commands**

```bash
pnpm dev          # local
# or managed:restart / platform deploy for production
```

---

## 3. Authentication

- [ ] Login succeeds (`POST /api/auth/login` → 200, session cookie set)
- [ ] Session persists after page refresh (`GET /api/auth/session` → 200)
- [ ] Logout works (`POST /api/auth/logout` → 204, session invalidated)
- [ ] Expired or revoked session redirects to `/login` (middleware + API 401)
- [ ] CSRF enforced on mutating session-authenticated requests
- [ ] Sign out and sign in again after auth-related deploys

**Notes:** Local dev must use same-origin `/api` proxy (not `http://localhost:4000/api` directly).

---

## 4. Subscription & Entitlements

- [ ] `GET /api/subscription` returns plan, status, `entitlementsByDomain`, `remediationGovernance`, and `usage`
- [ ] `accessMode` and `billingWarning` reflect subscription status
- [ ] Limit enforcement rejects over-quota creates:
  - [ ] applications (`monitoring.applications.max`)
  - [ ] monitors (`monitoring.monitors.max`)
  - [ ] SLOs (`monitoring.slos.max`)
  - [ ] team members (`team.members.max`)
- [ ] Feature gating works:
  - [ ] diagnosis AI (`diagnosis.ai.enabled`)
  - [ ] remediation tiers (`remediation.*`)
- [ ] Past-due subscription shows grace warning; unpaid restricts mutations

---

## 5. Billing (Stripe test mode)

Configure test keys and price IDs, then run `pnpm billing:sync-prices`.

- [ ] Checkout completes and redirects back to `/subscription`
- [ ] Webhook updates subscription (plan, status, period dates)
- [ ] Billing portal opens for existing customer
- [ ] Upgrade changes entitlements
- [ ] Downgrade / cancellation follows policy (access until period end when applicable)
- [ ] Failed payment → `PAST_DUE` / `UNPAID` (not immediate data deletion)
- [ ] Duplicate webhook delivery is idempotent (`StripeWebhookEvent` table)
- [ ] Unknown price ID rejected safely (no DB mutation)
- [ ] Invalid webhook signature → HTTP 400

---

## 6. Retention

- [ ] Dry-run produces per-org deletion counts without deleting data
- [ ] Live sweep deletes only eligible telemetry, resolved incidents, and incident memory
- [ ] Active incidents are never pruned
- [ ] Incident memory follows `retention.incident_memory.days` (separate from incident retention)
- [ ] Per-org logs and summary metrics are emitted
- [ ] Organizations with failed policy resolution are skipped, not partially deleted

**Commands**

```bash
# Dry-run (local)
cd apps/worker
WORKER_RETENTION_DRY_RUN=true pnpm exec tsx -e "import { runRetentionSweep } from './src/services/retention.service.ts'; runRetentionSweep({ dryRun: true }).then(console.log)"
```

---

## 7. AI Diagnosis

- [ ] Diagnosis eval suite passes
- [ ] LLM output schema validation rejects malformed responses
- [ ] Similar-incident retrieval returns context when memory entries exist
- [ ] Resolving an incident creates an `IncidentMemoryEntry`
- [ ] Subsequent similar incidents surface historical context

**Commands**

```bash
cd apps/api
pnpm test -- src/services/ai/incident-diagnosis.eval.test.ts
pnpm test -- src/services/ai/incident-memory.service.test.ts
```

---

## 8. Worker Jobs

Confirm scheduled jobs execute without error:

- [ ] HTTP / SSL checks
- [ ] Heartbeat stale processing
- [ ] Alert escalation
- [ ] Incident correlation
- [ ] SLO burn-rate evaluation
- [ ] Retention pruning
- [ ] Maintenance window transitions
- [ ] Automation autonomous sweep (if enabled)

---

## 9. Monitoring Regression (end-to-end)

- [ ] Register an application
- [ ] Connect using API key + signing secret
- [ ] First heartbeat received
- [ ] Modules / workflows / components discovered or registered
- [ ] Alert triggered from check or event
- [ ] Incident opened and visible in dashboard
- [ ] Incident resolved
- [ ] `IncidentMemoryEntry` created on resolution
- [ ] Similar incident diagnosis references prior context

---

## 10. Automated Test Gate

- [ ] `pnpm -r typecheck` passes (web, api, worker)
- [ ] `pnpm --filter @opswatch/api test` passes
- [ ] `pnpm --filter @opswatch/worker test` passes
- [ ] `pnpm build` succeeds for deployable apps

---

## 11. Operations

- [ ] Backup verified or scheduled for target database
- [ ] Rollback plan documented (previous image/tag + migration reversal strategy)
- [ ] Environment variables set for target (`STRIPE_*`, `DATABASE_URL`, `OPSWATCH_WEB_URL`, worker secrets)
- [ ] Stripe webhook endpoint registered and secret matches deployment

---

## Sign-off

| Role | Name | Date | Environment | Result |
|------|------|------|-------------|--------|
| Engineering | | | | |
| Operations | | | | |

**Go / No-Go:** _______________
