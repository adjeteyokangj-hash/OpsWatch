# OpsWatch controlled release prep — 2026-07-16

**Scope:** Local documentation / gate evidence only. **No `git push`. No deploy. No production changes.**

**Final verdict:** **READY FOR PUSH APPROVAL**

---

## Addendum — blocker clear (same day)

| Item | Result |
|------|--------|
| Tip SHA | `f0ce9c3` (`docs(release): mark 2026-07-16 prep READY FOR PUSH APPROVAL`) — product tip `89aa299` |
| Range | `origin/main..HEAD` — **53** commits; Modules fix `ca92098` **included** |
| Product dirty files | **Committed** (session-expired UX, Prisma local pool, header testids, gitignore, test isolation, plan retry fix) |
| Left uncommitted (intentional) | `.e2e-post-ui-validation/`, `.phase*-validation/`, `.phase5-validate.ps1`, `.release-prep/`, `apps/web/scripts/` — **out of release** |
| Secrets | Not staged; `.env` never committed |
| E2E `--full` | **PASS 10/10** after stack rebuild — `.release-prep/e2e-full-after-fix.summary.txt` |
| Live-heal / remediator / autonomous | Still **OFF for production** until separate approval (honesty unchanged) |

**automation-flow root cause (fixed):** incident page auto-retried `POST …/plan` on 404, leaving UI stuck on “Planning…”. Stopped retry after error; E2E waits for Planning to settle.

---

## 1. Working tree

**Status after blocker clear:** No tracked modifications. Branch `main` ahead of `origin/main` by **53** commits. Untracked validation/tooling dirs only (excluded below).

| Path | Classification | Blocks release? |
|------|----------------|-----------------|
| *(committed)* session-expired UX, Prisma local pool, test isolation, plan retry, header testids | Release commits on tip | Cleared |
| `.e2e-post-ui-validation/`, `.phase10-validation/`, `.phase5-validation/`, `.phase5-validate.ps1` | Local validation junk | **Exclude** — do not commit |
| `.release-prep/` | Local gate logs / scratch | **Exclude** — do not commit |
| `apps/web/scripts/` (e.g. screenshot capture) | Untracked tooling | **Exclude** — not shipping |

**Secrets:** Do not commit `.env`, credentials, or Vercel pulls.

---

## 2. Release commit list

**Range:** `origin/main..HEAD`  
**Base:** `fe5c9b4884fe22d1b2346e8e2f578cfff4965926` (`origin/main`)  
**Tip at prep (updated):** `f0ce9c3` — docs READY verdict (product tip `89aa299`)  
**Count:** 53 commits (includes original prep docs `a928987` + blocker-clear commits + this verdict update)

| SHA | Subject |
|-----|---------|
| `83bd8ad` | fix(api): stop topology N+1 CheckResult queries that timeout on Vercel |
| `611e4e4` | feat(web): evolve topology feed into facts-first Operations Timeline |
| `b0fc4c4` | feat(api): add evidence-based intelligence foundation |
| `3c2da86` | feat(web): ship Intelligence page and operations command centre hooks |
| `cbfcaf7` | feat(api): enrich incident and alert list DTOs with real scope data |
| `00a49a4` | feat(web): complete application workspace tabs with real-data wiring |
| `3796d68` | feat(web): upgrade portfolio, incidents, alerts, and topology polish |
| `c505078` | fix(web): place Logs tab at log-streams to avoid gitignored logs path |
| `bb18894` | docs: add StarLiz and TrueNumeris OpsWatch onboarding checklist |
| `8ddb277` | feat: StarLiz Academy graph seed and refresh onboard checklist |
| `763e39f` | feat(web): finish release UI alignment for apps, topology, and incidents |
| `57033b4` | fix(web): clear lint warnings and harden prediction gates |
| `b5e29dc` | fix(api): unblock database e2e entitlements and connect journey |
| `d5f0599` | fix(web): harden login hydration and local UI smoke tooling |
| `be536aa` | fix(scripts): load API env and probe DB connectivity for local stack wait |
| `efb5821` | fix(api): add production-guarded E2E auth rate-limit bypass for local smoke |
| `2cef390` | docs(architecture): complete Phase 1 assessment pack |
| `63e2802` | fix(web): unblock post-login data load when /auth/session stalls |
| `e6e442d` | fix(web): surface recoverable session check failures |
| `16ba109` | fix(web): prevent hung auth session from blocking mobile dashboard data |
| `0d9f5c9` | feat(phase2): establish universal operational graph foundation |
| `1090c28` | feat(phase3): add agentless monitoring and change ledger |
| `93e4ec9` | feat(telemetry): add OpenTelemetry ingestion bridge and TypeScript client |
| `cc2bd64` | feat(phase5): adaptive topology health roll-up and learned relationship controls |
| `5c7002c` | feat(phase6): alert correlation, RCA confidence labels, and incident intelligence |
| `714d26c` | feat(phase7): ownership routing, error budgets, and controlled automation gates |
| `7cc861e` | feat(phase8): gated learning and prediction framework with feature-gate registry |
| `53a614f` | feat(phase9): wire correlation, ownership, gates, and error budgets into UI |
| `de5f164` | feat(applications): add scalable company search and application browsing |
| `5b010c4` | fix(topology): preserve live topology design with additive platform capabilities |
| `0632b39` | fix(topology): remove canvas control overlap and label unconnected modules |
| `a0b64e5` | feat(topology): clickable relationships, Topology key, and honest heartbeat automation status |
| `e531c0b` | fix(topology): restore evidence-based edge colours and edge click selection |
| `dad9ade` | fix(topology): make Setup required drawer CTA navigate to connections |
| `ed84901` | fix(topology): clarify hierarchy health and hide more-node ids |
| `6e8e238` | Collapse lower Intelligence panels by default. |
| `44849dd` | feat(topology): wire Fix with automation deep-links, remediator capability, and remediating pulse |
| `422d4ff` | feat(remediator): project-level Worker remediator webhooks with signed repair |
| `3178ee1` | feat(topology): honest relationship automation drawer UX |
| `9f7faa5` | feat(web+api): render incident-memory confidence in topology drawer |
| `f322a86` | feat(automation): project autonomous mode toggle and incident-memory tests |
| `a26961a` | feat(web): group project workspace nav into operational sections |
| `dd5a4a8` | feat(web): accordion project workspace navigation |
| `e030036` | feat(web): align project pages to Topology workspace chrome |
| `3b408e8` | fix(e2e): unblock post-UI-sweep local smoke and journeys |
| `ca92098` | fix(web): separate Modules card Edit and View details actions |
| `a928987` | docs(release): add 2026-07-16 controlled release prep report |
| `f85834a` | fix(api): isolate controlled-automation tests from local .env gate flags |
| `ee90c75` | fix(api): raise local Prisma pool defaults for concurrent smoke load |
| `a7a4a3e` | feat(web): show session-expired notice on login redirect |
| `288283e` | chore(web): add header testids and ignore e2e auth artefacts |
| `89aa299` | fix(web): stop automation plan auto-retry loop on 404 |
| `f0ce9c3` | docs(release): mark 2026-07-16 prep READY FOR PUSH APPROVAL |

**Proposed push tip:** `f0ce9c3` (verify: `git rev-parse HEAD`).

---

## 3. Migrations

**Local:** `pnpm --filter @opswatch/api exec prisma migrate status` → **PASS** — 45 migrations; database schema up to date.

**New vs `origin/main` (10)** — apply in this order on production (`DIRECT_URL` / session pooler):

1. `20260708090000_okanggroup_health_hierarchy` — ServiceType MODULE/WORKFLOW/COMPONENT
2. `20260714170000_intelligence_foundation` — observation/learning/prediction + related fields
3. `20260715093000_universal_operational_foundation` — connections, locations, topology mode
4. `20260715140000_agentless_connections_change_ledger` — connection fields + ChangeLedgerEntry
5. `20260715180000_operational_relationship_impact_role` — impactRole / observationCount
6. `20260715190000_phase6_alert_incident_correlation` — fingerprints, merge/reopen
7. `20260715200000_phase7_ownership_routing` — owner/team/runbook/escalation fields
8. `20260715210000_alert_recovery_statuses` — REMEDIATING / VERIFYING / RECOVERING
9. `20260716010000_remediator_repair_attempts` — remediator repair-attempt tracking
10. `20260716120000_project_autonomous_mode_enum` — project autonomous mode enum remap

**Production migration order (runbook):** migrate **before or immediately after** first deploy of this SHA range; do **not** rely on Vercel build to migrate. Prefer:

```powershell
cd C:\Users\edwar\Documents\Projects\opswatch
# Ensure apps/api/.env DIRECT_URL = Supabase session pooler (port 5432)
pnpm db:migrate
```

---

## 4. Environment-variable checklist

Names only — no secret values. Sources: `apps/api|.web|.worker/.env.example`, remediator/automation code, `docs/unified-deploy-migration.md`, `docs/vercel-api-phase1.md`.

### OpsWatch web (`opswatch-production` / unified)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_OPSWATCH_API_URL` | Yes | Prefer `"/api"` same-origin |
| `OPSWATCH_API_ORIGIN` | No (unified) | **Remove** for embedded API; set only for legacy split proxy |
| `OPSWATCH_EMBEDDED_API` | Optional | Default embedded when origin unset |
| *Plus all API secrets on the web project when unified* | Yes | See API list below |

### OpsWatch API (embedded on web project, or legacy `ops-watch-api`)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Transaction pooler `:6543` + `pgbouncer=true` |
| `DIRECT_URL` | Yes (migrate) | Session pooler `:5432` |
| `JWT_SECRET` | Yes | ≥32 chars, non-placeholder |
| `OPSWATCH_WEB_URL` | Yes | e.g. `https://opswatch.okanggroup.com` |
| `WORKER_INTERNAL_SECRET` | Yes | Must match worker |
| `OPSWATCH_SECRETS_ENCRYPTION_KEY` | Yes for remediator secrets | Encrypts stored webhook secrets |
| `PLATFORM_SUPER_ADMIN_EMAILS` | Yes | Platform admin allowlist |
| `SESSION_SIGNING_REQUIRED` | Recommended | Default true |
| `INGEST_SIGNING_REQUIRED` | Recommended | Default true |
| `VERCEL_WEBHOOK_SECRET` / `GITHUB_WEBHOOK_SECRET` / `RENDER_WEBHOOK_SECRET` | If using inbound webhooks | Fail-closed if unset |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PUBLISHABLE_KEY` | If billing | Plus `STRIPE_PRICE_*` |
| `SMTP_*` / `ALERT_*` | Optional | Email alerts |
| `OPENAI_API_KEY` | Optional | Only if LLM diagnosis enabled |
| `INCIDENT_AI_LLM_ENABLED` | Optional | Default `false` |
| Feature gates | Keep off until intentional | `OPSWATCH_AUTO_REPAIR_ENABLED`, `OPSWATCH_AUTOMATION_TEST_MODE`, `AUTO_HEAL_DEFAULT_ENABLED`, `OPSWATCH_PREDICTIONS_ENABLED`, `OPSWATCH_OTEL_INGESTION_ENABLED`, `OPSWATCH_LEARNED_TOPOLOGY_ENABLED`, `OPSWATCH_ADVANCED_RCA_ENABLED` |

### Worker

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Same DB |
| `OPSWATCH_API_URL` | Yes | API base including `/api` |
| `WORKER_INTERNAL_SECRET` | Yes | Match API |
| `WORKER_AUTO_HEAL_ENABLED` | Prod default off | `false` until policy ready |
| `WORKER_AUTOMATION_AUTONOMOUS_ENABLED` | Prod default off | Autonomous sweep |
| `WORKER_AUTOMATION_AUTONOMOUS_INTERVAL_MS` | Optional | Default 300000 |
| `WORKER_RETENTION_*` | Optional | Retention sweep |
| `OPSWATCH_HEARTBEAT_API_KEY` / `OPSWATCH_HEARTBEAT_SIGNING_SECRET` | If heartbeats | Self-monitor |
| `SMTP_*` | Optional | |

### Autonomous Mode

| Variable / config | Required | Notes |
|-------------------|----------|-------|
| `OPSWATCH_AUTO_REPAIR_ENABLED` | Keep `false` until approved | High-impact gate |
| `OPSWATCH_AUTOMATION_TEST_MODE` | Keep `false` in prod | Records without mutate |
| `AUTO_HEAL_DEFAULT_ENABLED` | Keep `false` | |
| `AUTOMATION_AUTONOMOUS_SWEEP_LIMIT` | Optional | API |
| `WORKER_AUTOMATION_AUTONOMOUS_ENABLED` | Keep `false` until ready | Worker sweep |
| `AUTOMATION_LLM_PLANNER_ENABLED` | Keep `false` unless intentional | |
| Project `automationMode` / DB enum | Per-project | After migration `20260716120000_*` |
| Entitlement ceilings | Plan-gated | Autonomous tiers |

### Incident Memory

| Variable / config | Required | Notes |
|-------------------|----------|-------|
| No dedicated `INCIDENT_MEMORY_*` env | — | Feature uses DB + entitlements |
| `INCIDENT_AI_LLM_ENABLED` / `OPENAI_API_KEY` | Optional | Richer diagnosis |
| `retention.incident_memory.days` (entitlement) | Plan | Retention pruning |
| `OPSWATCH_SECRETS_ENCRYPTION_KEY` | If encrypting related secrets | |

### Remediator webhooks and shared secrets

| Variable / config key | Required | Notes |
|-----------------------|----------|-------|
| `WORKER_RESTART_WEBHOOK_URL` | Per integration | Env fallback and/or project `configJson` |
| `SERVICE_RESTART_WEBHOOK_URL` | Per integration | |
| `DEPLOYMENT_ROLLBACK_WEBHOOK_URL` | Per integration | |
| `REMEDIATOR_WEBHOOK_URL` | Project config | Project-level remediator |
| `REMEDIATOR_WEBHOOK_SECRET` | Project config | Stored encrypted (`_remediatorSecretEnc`); never leave plaintext in config responses |
| `REMEDIATOR_CAPABILITIES` | Project config | Capability allowlist |
| `REMEDIATOR_EMERGENCY_DISABLED` | Project config | Kill switch |
| `REMEDIATOR_CIRCUIT_FAILURE_THRESHOLD` / `REMEDIATOR_CIRCUIT_OPEN_MS` / `REMEDIATOR_MAX_RETRIES` / `REMEDIATOR_VERIFY_WAIT_MS` | Optional env | Circuit / retry |
| `OPSWATCH_SECRETS_ENCRYPTION_KEY` | **Required** to store remediator secrets | |
| `WORKER_INTERNAL_SECRET` | Internal calls | |

---

## 5. Secrets / junk hygiene

**Committed range (`origin/main..HEAD`):** No `.env`, credentials, `*.pem`, backups, or raw log dumps flagged in added files. Near-misses are source/tests only (e2e helpers, log-streams UI).

**Do not stage/commit:** `.e2e-post-ui-validation/`, `.phase*-validation/`, `.release-prep/` logs, `.env*`, Vercel env pulls.

**Mock remediator:** `scripts/mock-remediator-server.mjs` is local tooling — fine in repo; not a production secret.

---

## 6. Final local gates (this session)

| Gate | Result | Evidence |
|------|--------|----------|
| Typecheck `pnpm typecheck` | **PASS** | `.release-prep/typecheck.log` |
| Unit/integration tests | **PASS** after isolation fix | API 282, worker 24, web 104; `.release-prep/gates-retry.txt` |
| First `pnpm test` (pre-fix) | **FAIL** | `controlled-automation.service.test.ts` env pollution from local `.env` |
| Production build | **PASS** (retry) | Web `next build` + API `tsc`; full `pnpm build` hit Prisma DLL `EPERM` once (Windows lock) |
| Migrate status | **PASS** | 45 migrations, up to date |
| E2E `--full` (prior) | **PASS 10/10** | `.e2e-post-ui-validation/SUMMARY.md` |
| E2E `--full` (pre-clear, dirty tip) | **FAIL 9/10** | `automation-flow` Planning… loop; `.release-prep/e2e-full-rerun.summary.txt` |
| E2E `--full` (after blocker clear + rebuild) | **PASS 10/10** | `.release-prep/e2e-full-after-fix.summary.txt` |

**Release-blocker commits (local only):** see tip `89aa299` and commits `f85834a`…`89aa299`.

---

## 7. Controlled release runbook (for later approval — do not execute push/deploy now)

### Push order (after approval only)

```powershell
cd C:\Users\edwar\Documents\Projects\opswatch
# 1) Commit pending blockers (test isolation + decided dirty product files) OR stash/discard dirt
git status -sb
# 2) Confirm tip and range
git log --oneline origin/main..HEAD
# 3) Push main (ONLY after explicit user approval)
git push origin main
```

### Deployment order

1. **Confirm env** on Vercel `opswatch-production` (unified preferred): API secrets present; `OPSWATCH_API_ORIGIN` removed for embedded API.
2. **Migrate production DB** (session pooler `DIRECT_URL`) — see §3 — **before** relying on new schema features.
3. **Deploy web** (Vercel auto-deploy from `main`, or):

```powershell
# ONLY after push approval — example manual deploy
npx vercel deploy --prod --yes
# Project: opswatch-production (root vercel.json → pnpm --filter @opswatch/web vercel-build)
```

4. **Restart/redeploy worker** (PM2 / host) so it matches API schema and secrets:

```powershell
# Example local/managed pattern — adapt to production host
pnpm --filter @opswatch/worker build
pnpm managed:restart
```

5. **Leave autonomous / auto-repair / remediator live-heal OFF** until separately approved.

### Migration order

Exactly the 10 migrations in §3, via `pnpm db:migrate` against production `DIRECT_URL`. Verify:

```powershell
pnpm --filter @opswatch/api exec prisma migrate status
```

### Immediate production smoke

1. `GET https://opswatch.okanggroup.com/api/health/live` → 200  
2. `GET https://opswatch.okanggroup.com/api/health/ready` → 200  
3. Login → session cookie → dashboard loads  
4. Applications → open project → Topology renders  
5. Accordion workspace nav + Modules Edit vs View details  
6. Alerts / Incidents list load  
7. Sign out / sign in  
8. Optional: `pnpm gate:validate-env:strict` against pulled prod env (local only; never commit pull file)

### Rollback procedure

1. **App rollback:** Redeploy previous known-good Vercel deployment for `opswatch-production` (Vercel → Deployments → Promote prior).  
2. **Git rollback (if needed):** revert or reset tip on `main` only with explicit approval (prefer revert commits over force-push).  
3. **Migrations:** Prisma migrations are forward-only; do **not** auto-rollback SQL. If a migration is incompatible, restore DB from backup / apply manual down SQL prepared offline.  
4. **Feature flags:** Set `OPSWATCH_AUTO_REPAIR_ENABLED=false`, `WORKER_AUTOMATION_AUTONOMOUS_ENABLED=false`, `WORKER_AUTO_HEAL_ENABLED=false`, project remediator emergency disable.  
5. **Worker:** Restart previous worker build if binary/schema mismatch.

### Exact commands reserved for later approval

```powershell
# A. Finish local commits (test fix + any must-include dirt), clean tree
# B. Push
git push origin main

# C. Production migrate (from machine with DIRECT_URL)
cd C:\Users\edwar\Documents\Projects\opswatch
pnpm db:migrate

# D. Confirm Vercel production deployment for opswatch-production succeeded
# E. Restart worker on its host
# F. Run production smoke URLs above
```

---

## 8. Honest readiness separation

| Layer | Status | Notes |
|-------|--------|-------|
| Browser / product readiness | **Ready for push approval** | E2E **10/10** on tip `89aa299` after rebuild; accordion + Modules + session-expired + plan-panel fix included. Docs tip `f0ce9c3`. |
| **Monitoring readiness** | Ready for deploy with gates off | Heartbeats, checks, topology, alerts/incidents in browser E2E path. |
| **Autonomous remediation readiness** | **Not proven for prod enablement** | Code + migrations present; keep `OPSWATCH_AUTO_REPAIR_ENABLED` / worker autonomous flags **false** until separate approval. |
| **True live-heal readiness** | **Not ready** | Browser E2E ≠ proven remediator restart/repair of external apps. Live remediation remains a **separate gap** outside authenticated browser smoke. |

---

## Known risks

1. Ten production migrations — must run with correct `DIRECT_URL`; failure mid-range needs DB expertise.  
2. Remediator / autonomous features shipping **disabled** — accidental env enablement could mutate customer systems. Local smoke `.env` may have repair/test flags on; production must stay off.  
3. Windows Prisma `EPERM` during `prisma generate` if another Node process locks the query engine DLL.  
4. Unified vs split Vercel config drift (`OPSWATCH_API_ORIGIN` left set).  
5. Plan endpoint may still 404 when project mode disallows planning / playbook missing — UI now shows error instead of looping; operators may need playbook seed / mode config.

---

## Final verdict

### **READY FOR PUSH APPROVAL**

**Cleared blockers:**

1. Controlled-automation test isolation committed (`f85834a`).  
2. Dirty product files committed intentionally (`ee90c75`, `a7a4a3e`, `288283e`) or excluded as validation/tooling junk.  
3. Validation junk **not** committed.  
4. E2E `--full` **10/10** on rebuilt stack at tip `89aa299`.  
5. Modules fix `ca92098` already in range.

**Still required before / at deploy (operator):** production env checklist (§4), migration run (§3), and **keep remediator / auto-repair / autonomous production flags OFF** until separate live-heal approval.

**No push / deploy performed in this prep.**

---

*Updated locally 2026-07-16 after blocker clear. Supporting scratch logs under `.release-prep/` (not for commit).*
