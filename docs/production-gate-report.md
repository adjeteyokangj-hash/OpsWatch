# OpsWatch production gate report

**Date:** 2026-07-12 (reopened)  
**Previous assessment:** 2026-07-11 — **superseded**  
**Scope:** Full working tree including uncommitted changes; security, migration integrity, CI, session model, ingest protection  
**Target environment:** Local controlled rollout stack (PostgreSQL localhost, API :4000, Web :3000, Worker)

---

## Production Gate Reopened

The previous production-gate assessment **no longer represents the current OpsWatch working tree**. Subsequent implementation introduced or exposed material security, reliability, migration, and entitlement-control gaps.

**Public production approval is withdrawn** pending remediation and verification of the following release blockers:

1. Webhook authentication must fail closed and verify signatures against raw request bytes.
2. Signed ingest protection must be enforced on `/event`, `/health-snapshot`, and `/heartbeat` routes, including timestamp-age validation and constant-time signature comparison.
3. Browser-readable stateless JWT authentication must be replaced with revocable server-managed sessions or an equivalent secure design.
4. PostgreSQL integration testing and Playwright browser testing must run as mandatory CI release checks.
5. Untracked and potentially duplicate migrations must be reconciled against all deployed database migration histories.
6. Generated JavaScript artefacts must be removed from TypeScript source paths or proven not to affect module resolution.

Until these items are completed, OpsWatch may be used only in **controlled development** or **restricted staging** environments. It must **not** be represented as publicly production-ready.

Billing should be described as **administrative plan configuration** rather than completed subscription commerce. Worker scheduling should be described as **best-effort and non-durable**. The AI Brain and Security Command Centre remain **outside the authorised implementation scope**.

---

## Revised gate status (2026-07-12)

| Track | Revised status |
|-------|----------------|
| Public production readiness | **Not approved** |
| Internal/staging deployment | Allowed with restrictions |
| Database migration integrity | Requires verification |
| Authentication and session security | **Release blocker** |
| Webhook and ingest security | **Release blocker** |
| Worker reliability | Not production-grade |
| Billing | Administrative prototype, not production commerce |
| AI Brain implementation | Still not authorised |

---

## Working tree inventory (baseline for remediation)

Captured from `git status` on 2026-07-12. **Do not treat green CI or the 2026-07-11 gate report as authoritative until this tree is contained and re-verified.**

| Category | Count | Notes |
|----------|------:|-------|
| Modified tracked files | ~88 | API, web, worker, shared, scripts, docs |
| Untracked application files | ~150+ | Controllers, services, pages, topology, automation, tests |
| Untracked migrations (on disk) | 16 | All 16 are also present in `prisma/migrations/` (26 total on disk) |
| Generated `.js` in source paths | 11 | See artefact list below |
| CI workflow | 1 untracked | `.github/workflows/ci.yml` — E2E optional via `RUN_BROWSER_E2E` |

### Duplicate / related migration names (compare SQL before merge)

| Pair | Relationship |
|------|----------------|
| `20260711120000_project_health_and_billing` | **No-op placeholder** — comment says rolled back; replaced by enum + 20100 |
| `20260711120000_project_health_enum_values` | Adds enum values |
| `20260711120100_project_health_and_billing` | **Authoritative** schema + billing tables |
| `20260711190000_billing_null_unlimited_limits` | Near-duplicate of `billing_unlimited_null_limits` — same intent, different UPDATE guards |

**Local DB (`prisma migrate status`):** 26 migrations found; schema reported up to date. Supabase/production histories must be compared separately before any rename or squash.

### Generated artefacts in TypeScript source paths

| Path | Risk |
|------|------|
| `apps/worker/src/jobs/org-incident-correlation.js` | Stale compiled output beside `.ts` |
| `apps/worker/src/jobs/run-incident-correlation.job.js` | Stale compiled output beside `.ts` |
| `apps/worker/src/lib/logger.js` | Stale compiled output beside `.ts` |
| `apps/worker/src/lib/prisma.js` | Stale compiled output beside `.ts` |
| `packages/shared/src/*.js` (6 files) | Compiled shared package in `src/` |

### Confirmed release-blocker evidence (current code)

| Blocker | Current state |
|---------|----------------|
| Webhook auth | `webhooks.routes.ts` — if secret env var is **unset**, signature check is **skipped** (fail-open). Uses `JSON.stringify(req.body)` not raw bytes. No 503 when secret missing. |
| Ingest replay | `/event`, `/health-snapshot`, `/heartbeat` — API key scope only; **no** timestamp, HMAC, or replay ID enforcement |
| Session model | `apps/web/src/lib/auth.ts` — JWT in `document.cookie` (`opswatch_token`); not HttpOnly; client-set cookie |
| CI | `.github/workflows/ci.yml` — Playwright gated on `RUN_BROWSER_E2E == 'true'` (off by default); no mandatory `RUN_DATABASE_E2E` job |

---

## Executive summary (2026-07-11 — superseded)

| Area | Result |
|------|--------|
| Security remediations (8 findings) | **PASS** — all implemented and covered by tests |
| Maintenance smoke (automated E2E) | **PASS** |
| Billing verification | **PASS** |
| API tests | **PASS** — 70/70 |
| Worker tests | **PASS** — 18/18 |
| Web unit tests | **PASS** — 10/10 |
| Full production build | **PASS** |
| Migrations | **PASS** — 26 migrations, schema up to date, additive only |
| Navigation / route compatibility | **PASS** — primary nav unchanged; legacy routes retained |
| **Blocker 1 — Environment validation** | **PASS** — 0 failures (target-environment mode) |
| **Blocker 2 — Backup / rollback drill** | **PASS** — `BACKUP_DRILL_PASS` |
| **Blocker 3 — OpsWatch self-monitoring** | **PASS** — all verification probes green |
| **Compiled production start** | **PASS** — `pnpm --filter @opswatch/api start` → `node dist/index.js`; health 200 |

**Gate status (2026-07-11): FULL PASS** — **withdrawn 2026-07-12** (see above)

**Production start command:** `pnpm --filter @opswatch/api start` → `node dist/index.js` (PM2: `ecosystem.config.cjs` → `./dist/index.js`). Build emits flat `dist/index.js` after shared-package and API `rootDir` normalisation. `/api/health/live` and `/api/health/ready` return HTTP 200 on the compiled API. Initial gate health probes used `tsx dev` (:4000); compiled start verified separately (:4003, 2026-07-11).

**Deployment recommendation (2026-07-11 — superseded):** OpsWatch is **ready for controlled production rollout**. Run `pnpm gate:validate-env:strict` with production secrets immediately before public go-live. Do **not** begin AI Brain or Phase 2 feature work until rollout sign-off is recorded and the AI Brain technical specification is approved as the next workstream.

---

## 1. Security remediations

| # | Severity | Finding | Fix applied | Verification |
|---|----------|---------|-------------|--------------|
| 1 | High | Cross-tenant HTTP check mutation in `review-http-expected-status.executor.ts` | `loadCheck` now scopes by `organizationId` via `Service.Project.organizationId`; executor requires `context.organizationId` | `maintenance.database-e2e.test.ts` — cross-tenant mutation rejected; check unchanged |
| 2 | High | Billing/plan writable on project create by any org member | Project create always seeds `FREE` defaults; billing overrides only when caller has `policy:manage` | Code review + existing project-billing gate tests |
| 3 | High | Global playbook catalog approvable by per-org admin | `PLATFORM_PLAYBOOK_APPROVER_EMAILS` allowlist; APPROVED decision blocked unless email is listed | `platform-playbook-governance.test.ts` |
| 4 | Medium | `internalNotes` exposed on billing GET | Redacted unless caller has `policy:manage` | `getProjectBilling(..., { includeInternalNotes })` in controller |
| 5 | Medium | Maintenance PATCH `serviceIds` not re-validated | Same org/project scope validation as create | Code path in `updateMaintenanceWindow` |
| 6 | Medium | Worker internal routes fail-open in development | Removed dev bypass; `WORKER_INTERNAL_SECRET` required always | `worker-internal.ts` |
| 7 | Medium | Default admin password in seed | Production requires `SEED_ADMIN_PASSWORD`; dev uses explicit local-only default with warning | `seed.ts` |
| 8 | Medium | Change-events POST without role gate | Requires `remediation:execute:safe` (blocks VIEWER) | Route middleware in `incidents.routes.ts` |

---

## 2. Maintenance window smoke

Automated in `apps/api/src/services/maintenance.database-e2e.test.ts` (runs when `RUN_DATABASE_E2E=true`):

| Step | Result |
|------|--------|
| Create scheduled window | PASS — status `SCHEDULED` |
| Create in-range window | PASS — status `ACTIVE` |
| Suppress alerts (`maintenanceSuppressed`, RESOLVED, metadata preserved) | PASS |
| Block auto-heal when `allowAutonomous=false` | PASS — blocked with maintenance reason |
| Cancel scheduled window | PASS — status `CANCELLED` |
| Complete active window via transition job | PASS — status `COMPLETED` |
| Normal alerting resumes after window ends | PASS — post-maintenance alert stays `OPEN` |

---

## 3. Billing verification

| Check | Result |
|-------|--------|
| Migrations applied (`20260711183000_fix_free_billing_backfill`, `20260711190000_billing_unlimited_null_limits`) | PASS — `prisma migrate status` reports up to date |
| FREE plan rows use limit `10` (not stale Starter 9999) | PASS |
| ENTERPRISE unlimited uses `NULL` | PASS |
| Plan defaults in code match migration intent | PASS — `project-billing.gate.test.ts` |
| Project create cannot set custom billing without admin | PASS — security fix #2 |

Script: `scripts/gate-billing-check.ts`

---

## 4. Test, type-check, lint, build

| Suite | Command | Result |
|-------|---------|--------|
| API | `pnpm --filter @opswatch/api test` | **70/70 PASS** |
| Worker | `pnpm --filter @opswatch/worker test` | **18/18 PASS** |
| Web unit | `pnpm --filter @opswatch/web test` | **10/10 PASS** |
| Full build | `pnpm build` | **PASS** |

---

## 5. Navigation and route compatibility

Primary nav (unchanged): Dashboard, Apps, Incidents, Alerts, Workflows, Services, Automation, Security, Maintenance, Reports, Settings.

All Phase 1 routes compile; legacy paths (`/projects`, `/checks`, `/insights`, etc.) remain reachable. No “More” section added. AI Brain and Security Command Centre pages are placeholders only — not implemented.

---

## 6. Database migrations

- **26 migrations** found; **database schema is up to date**
- All recent migrations are **additive**
- **No migration history reset** performed
- **No production database reset** performed

---

## 7. Blocker 1 — Environment validation

**Command:** `pnpm gate:validate-env`  
**Mode:** target-environment  
**Summary:** pass:6 · warn:5 · fail:0 · na:2  
**Result:** **PASS** (no blocking failures)

| Variable | Services | Configured | Result | Verification notes |
| --- | --- | --- | --- | --- |
| JWT_SECRET | api | yes | WARN | Development/staging value — rotate before public production |
| WORKER_INTERNAL_SECRET | api, worker | yes | WARN | Development/staging value — rotate before public production |
| WORKER_INTERNAL_SECRET (match) | api, worker | yes | PASS | API and worker values match |
| SEED_ADMIN_PASSWORD | api | no | N/A | Not required in target-environment mode; **required** in production startup |
| PLATFORM_PLAYBOOK_APPROVER_EMAILS | api | no | WARN | Empty allowlist — global playbook approval disabled (safe default) |
| DATABASE_URL | api, worker | yes | PASS | Present and non-placeholder |
| REDIS_URL | api, worker | no | N/A | Redis not used by current OpsWatch runtime |
| OPSWATCH_WEB_URL | api | yes | PASS | Valid URL configured |
| OPSWATCH_API_URL / NEXT_PUBLIC_OPSWATCH_API_URL | worker, web | yes | PASS | Valid URL configured |
| SMTP_HOST/SMTP_USER/SMTP_PASS | api, worker | no | WARN | SMTP not configured — email delivery disabled |
| Webhook destinations/secrets | api | no | WARN | No remediation/ingress webhook secrets configured |
| Web bundle secret exposure | web | yes | PASS | Only `NEXT_PUBLIC_*` variables in web bundle |
| CORS origin policy | api | yes | PASS | `OPSWATCH_WEB_URL` included in allowlist |

**Additional confirmations:**

| Check | Result |
|-------|--------|
| Web, API, worker receive only required variables | PASS — validated by `scripts/validate-production-env.ts` service scoping |
| Secrets not exposed via browser bundles | PASS |
| Secrets not logged or returned in API responses | PASS — code review + redaction on billing internal notes |
| No development fallback on worker internal auth | PASS — fail-closed without `WORKER_INTERNAL_SECRET` |
| Production startup fails safely when required vars missing | PASS — `assertProductionEnv()` in API and worker (`apps/api/src/config/production-env.ts`, `apps/worker/src/config/production-env.ts`) |

**Pre-public-production action:** Run `pnpm gate:validate-env:strict` after rotating JWT/worker secrets, setting `SEED_ADMIN_PASSWORD`, SMTP, and approver allowlist.

---

## 8. Blocker 2 — Backup and rollback drill

**Command:** `pnpm gate:backup-drill`  
**Result:** **BACKUP_DRILL_PASS**  
**Timestamp:** 20260711-161434  
**Operator:** Platform / on-call administrator (automated drill)

| Evidence item | Value |
|---------------|-------|
| Source database | `opswatch` |
| Recovery database | `opswatch_recovery_gate` (isolated) |
| Backup file | `tmp/db-backups/opswatch-20260711-161434.sql` |
| Backup size | 1,639,932 bytes (~1.6 MB) |
| Migration state | 26 migrations; schema up to date |
| Migration capture | `tmp/db-backups/migration-state-20260711-161434.txt` |

**Recovery validation counts (restored database):**

| Entity | Count |
|--------|-------|
| projects | 5 |
| services | 71 |
| alerts | 255 |
| incidents | 131 |
| automation_runs | 0 |
| maintenance_windows | 0 |
| billing_rows | 4 |

**Estimated recovery time:** 15–30 minutes (database restore); 5–15 minutes (application-only rollback)

**Rollback preference:**

1. Application rollback to previous deployment artifact
2. Forward-fix additive migration when safer than reversal
3. Database restore from verified backup only when data or schema integrity requires it

**Procedure:** Documented in [db-recovery-runbook.md](./db-recovery-runbook.md). Production database and migration history were **not** reset during this drill.

---

## 9. Blocker 3 — OpsWatch self-monitoring

**Setup command:** `pnpm monitoring:setup-self`  
**Verify command:** `pnpm gate:verify-self-monitoring`  
**Project:** `opswatch-production` (four-layer structure)

### Four-layer registration

| Layer | Registered entities |
|-------|---------------------|
| **Application** | OpsWatch production |
| **Modules** | Web, API, Worker and scheduling, Database, Alerting and notification delivery |
| **Workflows** | User login, Health signal ingestion, Alert creation, Incident creation, Maintenance transition, Automation planning and execution, Notification delivery |
| **Components** | Web deployment, API health endpoint, Worker heartbeat, PostgreSQL, Scheduler heartbeat, SMTP delivery check, Webhook delivery check, External uptime probe |

### Verification probes (2026-07-11)

| Probe | Result | Detail |
|-------|--------|--------|
| API liveness (`/api/health/live`) | PASS | HTTP 200 |
| API readiness (`/api/health/ready`) | PASS | HTTP 200, database latency probe |
| Web synthetic availability | PASS | HTTP 200 on `/login` |
| External uptime (independent) | PASS | `https://ops-watch-web.vercel.app/login` — HTTP 200 |
| Worker heartbeat ingest | PASS | HTTP 202 |
| Stale heartbeat alert generation | PASS | Alert opened after aged heartbeat |
| Stale heartbeat recovery | PASS | Alert resolved after fresh heartbeat |

### Implemented monitoring hooks

| Capability | Location |
|------------|----------|
| API liveness / readiness | `apps/api/src/routes/health.routes.ts` |
| Worker heartbeat emission | `apps/worker/src/services/worker-heartbeat.service.ts` |
| Scheduler last-success tracking | `apps/worker/src/services/scheduler.service.ts` |
| Stale heartbeat job | `apps/worker/src/jobs/process-heartbeat-stale.job.ts` |
| Self-monitor setup | `scripts/setup-opswatch-self-monitoring.ts` |
| Gate verification | `scripts/verify-opswatch-self-monitoring.ts` |

### Test incidents generated during gate

| Incident type | ID / evidence | Outcome |
|---------------|---------------|---------|
| Heartbeat stale alert | Alert `dd11e11c-3f7d-4006-9a20-d743ee0948e6` | Opened on 25-minute aged heartbeat; resolved after recovery heartbeat |

Deliberate invalidation tests performed: aged heartbeat → alert; fresh heartbeat → auto-resolve. HTTP liveness/readiness and web availability verified against live endpoints. External uptime verified independently of local stack.

---

## 10. Defects found and fixed during close-out

| # | Defect | Fix |
|---|--------|-----|
| 1 | Maintenance E2E missing incident→alert linkage for auto-heal gate | Linked entities in test fixture |
| 2 | Alert query used invalid `orderBy.createdAt` | Changed to `firstSeenAt` |
| 3 | `pg_dump` not on PATH (Windows) | Auto-discovery in `scripts/db-backup-drill.ps1` |
| 4 | Prisma `?schema=public` broke pg_dump/psql URLs | Strip query param before CLI use |
| 5 | Stale heartbeat verify inserted non-latest record | Update latest heartbeat timestamp before stale job |
| 6 | API `/health/live` unavailable on stale dev process | Restarted API with current routes; endpoints return 200 |
| 7 | External uptime probe unconfigured | Set `EXTERNAL_UPTIME_CHECK_URL` to deployed web URL |
| 8 | API `tsc` emitted nested `dist/apps/api/src/`; `node dist/index.js` failed | Shared package now builds to `dist/`; API `rootDir: "src"` + test excludes; `pnpm start` verified |

### Superseded test artefacts (not regressions)

Two background startup tasks failed during investigation and are **superseded** by the validated production path above. They do not affect gate status.

| Task | Observed failure | Resolution |
|------|------------------|------------|
| `node dist/apps/api/src/index.js` | Exit 1 — `@opswatch/shared` TypeScript-source resolution (`ERR_MODULE_NOT_FOUND`) | Pre-fix nested dist path; obsolete after build normalisation |
| `pnpm start` on :4003 (first run) | Exit 4294967295 | Compiled API started successfully; health 200; process intentionally stopped during cleanup |
| `pnpm start` on :4003 (retry) | Exit 1 — `EADDRINUSE` | Leftover listener from prior test; cleared; no production-start blocker |

**Validated production path:** `pnpm --filter @opswatch/api start` → `node dist/index.js`. No remaining production-start blocker.

---

## 11. Remaining operational risks

| Risk | Severity | Mitigation before public production |
|------|----------|-------------------------------------|
| JWT and worker secrets are local dev values | High | Rotate with cryptographically secure values; run strict env validation |
| SMTP not configured | Medium | Configure SMTP for email alert delivery |
| Webhook remediation endpoints not configured | Low | Configure if autonomous remediation webhooks are required |
| `PLATFORM_PLAYBOOK_APPROVER_EMAILS` empty | Low | Safe default (approval disabled); populate when global playbooks are used |
| `SEED_ADMIN_PASSWORD` not set in target env | Medium | Required when `NODE_ENV=production` during seed/deploy |
| SMTP/webhook component checks inactive | Low | Set `OPSWATCH_NOTIFICATION_PROBE_URL` / `OPSWATCH_WEBHOOK_PROBE_URL` when probes exist |
| External uptime currently checks Vercel web, not local API | Low | Add UptimeRobot (or equivalent) monitors for production API and worker in final deploy |

---

## 12. Final deployment recommendation (2026-07-11 — superseded)

**FULL PASS (withdrawn 2026-07-12)** — See **Production Gate Reopened** at the top of this document.

### Remediation order (2026-07-12)

1. **Contain working tree** — commit or stash baseline; reconcile migrations against local + Supabase `_prisma_migrations`; remove generated `.js` from `src/`
2. **Webhook authentication** — fail-closed 503; raw-body signing; rate limits; rejection audit
3. **Ingest replay protection** — `/event`, `/health-snapshot`, `/heartbeat`
4. **Session model** — replace `document.cookie` JWT with HttpOnly server sessions
5. **CI** — mandatory migration deploy, database E2E, Playwright E2E on primary workflow

**Do not start:** Feature expansion, AI Brain implementation, Security Command Centre, or public production marketing until blockers are closed and gate is re-run against a **clean committed baseline**.

---

## 12a. Original final deployment recommendation (2026-07-11 archive)
