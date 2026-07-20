# Phase 8 — Security and threat foundation inventory

Date: 2026-07-20  
Baseline: `47bd5b49642a25d8f662f4820edbc616fe90ff42` on `main`  
Programme source: `docs/opswatch-observability-programme.md` (Phase 8)

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. This inventory locks what already exists
for **platform access security** and **adjacent operational signals** before
Phase 8 threat work. Placeholders, enums without writers, Foundation UI, and
entitlement keys without runtime do **not** count as completed capability.

**Hard stop:** There are **no** `SecurityFinding`, `SecurityEvent`,
`ThreatCorrelationSequence`, vulnerability, attack-path, or risk-score models.
The Security page is Foundation-only. Phase 8 must not invent findings, claim
attack prediction, claim containment without verified actions, or begin native
Datadog/Dynatrace connectors. Phase 9 learning/prediction must not begin.

---

## Existing stop points (summary)

| Exists today (platform / ops) | Phase 8 must build / prove |
| --- | --- |
| Session auth, CSRF, roles/permissions, password policy | Security-event ingestion + identity baselines as product evidence |
| `OrgApiKey` + managed credentials + credential audit actions | API-abuse and privilege-change **detection** (not only auth reject) |
| Generic `AuditLog` + members audit UI | Security findings store + evidence-linked incidents |
| Event types `AUTH_*`, `WEBHOOK_SIGNATURE_FAILED` → `AlertCategory.SECURITY` | First-class security findings (not only generic alerts) |
| OTEL log heuristic `otel.log.auth_failure` → SECURITY alerts (flag-gated) | Verified identity/auth baselines; not body-regex alone |
| SSL cert expiry checks (category `DEPENDENCY_CHANGE`) | URL/SSL/DNS/**security-header** product checks as threat evidence |
| SSL/HTTP failure classification (`DNS_FAILURE`, `TLS_FAILURE`) | External attack-surface monitors with honest depth labels |
| Phase 7 remediation (rotate webhook, disable integration, rerun SSL) | Approved **containment** actions with governance (distinct from heal) |
| Foundation Security page + product-truth E2E | Real Security workspace with coverage + findings; no seeded threats |
| Entitlement keys `security.mtls` / `security.sso` | Actual mTLS/SSO product paths (keys alone ≠ capability) |

---

## Missing models (confirmed)

Searched Prisma + codebase: **no** `SecurityFinding`, `SecurityEvent`,
`Threat*`, `Vulnerability*`, `AttackPath`, `RiskScore`, or
`SecurityResponseRun` models. Closest security-adjacent persistence:

| Model | Path | Role vs Phase 8 |
| --- | --- | --- |
| `AuditLog` | `apps/api/prisma/schema.prisma` | Platform activity trail |
| `OrgApiKey` | same | Inbound API key lifecycle |
| `ManagedCredential` | same | Encrypted credential versions |
| `User` / `UserSession` | same | Identity + session |
| `Event` + `Alert` (`category: SECURITY`) | same | Ops event → alert spine |
| `IngestReplayNonce` | same | Replay protection (not security finding) |
| `LogRecord` / OTEL signals | same | Telemetry that *may* feed heuristics |
| `ChangeEvent` / `ChangeLedgerEntry` / `DeploymentRecord` | same | Change correlation, not threat |
| `RemediationLog` / automation runs | same | Phase 7 heal — not security containment product |

---

## Path inventory

For every path: **source · persistence · correlation · detection rules · UI ·
response capability · runtime verification · current limitation**.

### 1. Security page and routes

| Aspect | State |
| --- | --- |
| Source | Static Next page only — no API |
| Persistence | None |
| Correlation | Links to `/auto-run-policy`, `/settings`, `/members` |
| Detection rules | Explicitly states none |
| UI | `apps/web/src/app/security/page.tsx` — `data-testid="security-foundation-state"`; `ProductTruthStatus` Foundation + “Requires connection” |
| Response capability | None |
| Runtime verification | `apps/web/e2e/phase5-product-truth.spec.ts` asserts Foundation copy |
| Current limitation | **Placeholder.** Nav entry in `apps/web/src/components/layout/sidebar.tsx` (`Security` → `/security`). No findings list, coverage panel, attack paths, or containment UI |

Phase 5 inventory already labelled this Foundation (`docs/phase5-product-truth-inventory.md`).

### 2. Authentication events (OpsWatch login / sessions)

| Aspect | State |
| --- | --- |
| Source | `login` / logout / password change — `apps/api/src/services/auth.service.ts`, `apps/api/src/controllers/auth.controller.ts`, `apps/api/src/routes/auth.routes.ts` |
| Persistence | `UserSession` (token/CSRF hashes, IP, UA, expiry, revoke reason). **Failed login is not written to `AuditLog`** — only logger warn |
| Correlation | Session revoke reasons: `LOGIN_ROTATION`, `PASSWORD_CHANGED`, `LOGOUT`, `ROLE_CHANGED`, `USER_DEACTIVATED`, `PASSWORD_RESET` |
| Detection rules | None (no brute-force / geo / anomaly product) |
| UI | Login page; session cookies via `session-cookie.ts` |
| Response capability | Revoke all sessions on login/password/role/deactivate |
| Runtime verification | `auth.session.test.ts`, `session.database-e2e.test.ts`, `apps/web/e2e/smoke/01-auth-session.spec.ts`, `auth.service.test.ts` |
| Current limitation | No `LOGIN_SUCCEEDED` / `LOGIN_FAILED` audit or security-event stream; IP/UA stored but not analysed as product evidence |

Password policy: `apps/api/src/utils/password-policy.ts`.

### 3. API-key events

| Aspect | State |
| --- | --- |
| Source | `authorizeApiKey` in `apps/api/src/middleware/auth.ts` |
| Persistence | `OrgApiKey` (`expiresAt`, `revokedAt`, `graceExpiresAt`, `lastUsed*`, rotation fields); audits via `recordCredentialAudit` → `AuditLog` (`AUTH_FAILED`, `CREDENTIAL_USED`) |
| Correlation | Org-scoped audit metadata (route, IP, UA, reason) |
| Detection rules | Expiry, revoke, grace, per-key in-memory rate limit (default 120/min), scope, environment mismatch (`x-opswatch-environment`) |
| UI | Org page API keys + `apps/web/src/lib/credential-status.ts` lifecycle pills |
| Response capability | HTTP 401/403/429; no alert/finding creation from auth failures |
| Runtime verification | `middleware/auth.test.ts`, `credential-security.database-e2e.test.ts`, `apps/web/e2e/credential-security-api-keys.spec.ts` |
| Current limitation | Failures are credential audits, **not** Phase 8 security findings / API-abuse baselines; in-memory rate limit not shared across instances; no spike aggregation into findings |

### 4. Audit logs

| Aspect | State |
| --- | --- |
| Source | Many writers: credentials, users, remediation, automation, connections, OTEL bridge, billing, SLOs, etc. |
| Persistence | `AuditLog` (`action`, `entityType`, `entityId`, `metadataJson`, optional `organizationId`/`userId`) |
| Correlation | Org + time index; members list joins recent rows |
| Detection rules | None — append-only trail |
| UI | `apps/web/src/app/members/page.tsx` + `GET /users/audit-logs` |
| Response capability | Informational only |
| Runtime verification | Scattered unit/DB E2E asserting `auditLog.create` |
| Current limitation | Generic string actions; no security taxonomy; not a findings store; privilege changes audited (`USER_ROLE_UPDATED`) but **not** auto-elevated to security incidents |

Credential-specific helper: `apps/api/src/services/credentials/credential-audit.service.ts` (redacts secret-like metadata).

### 5. Webhook-signature failures

| Aspect | State |
| --- | --- |
| Source A | Provider inbound: `apps/api/src/middleware/webhook-auth.ts` (Vercel/GitHub/Render) + Stripe path in `webhooks.routes.ts` |
| Source B | Customer signed ingest: `middleware/ingest-replay.ts`, `connection-ingest.controller.ts`, `otel-bridge.controller.ts` |
| Persistence | **Reject path:** logger only. **Accepted ops events:** `EventType.WEBHOOK_SIGNATURE_FAILED` can be ingested via events API → `Event` + `Alert` |
| Correlation | Event → alert via `events.service.ts` (`category: SECURITY`) |
| Detection rules | Signature/body/secret missing/invalid; ingest timestamp window + nonce replay |
| UI | Alerts list shows category when present; no dedicated signature-failure console |
| Response capability | Diagnosis may suggest `RETRY_WEBHOOKS` / `DISABLE_INTEGRATION` — diagnosis category for webhook signature is often **RELIABILITY**, while event→alert category is **SECURITY** (inconsistency) |
| Runtime verification | `webhooks.routes.test.ts`, `ingest-replay` tests, otel-bridge replay tests |
| Current limitation | Auth middleware failures **do not** create `WEBHOOK_SIGNATURE_FAILED` events automatically; enum exists for **customer-reported** ingest, not platform webhook rejects |

### 6. Rate-limit events

| Aspect | State |
| --- | --- |
| Source | Global IP `rateLimit` (`apps/api/src/middleware/rate-limit.ts`); per-API-key buckets in `auth.ts`; automation/remediator rate limits (Phase 7) |
| Persistence | **None** for IP 429s; API-key rate limit → `AUTH_FAILED` audit with `reason: rate_limited` |
| Correlation | None to alerts/incidents |
| Detection rules | 200 req/min IP (prod); 120/min API key (configurable) |
| UI | None |
| Response capability | HTTP 429 only |
| Runtime verification | `rate-limit.test.ts`, `auth.test.ts` |
| Current limitation | Not a security-event source; no abuse timeline; E2E bypass headers exist (non-prod only) |

### 7. OTEL logs (security-relevant)

| Aspect | State |
| --- | --- |
| Source | OTEL bridge → normalize → process; policy in `otel-policy.service.ts` |
| Persistence | `NormalizedOperationalSignal`, Phase 6 `LogRecord` (redacted), observations |
| Correlation | Alert/incident evidence when flags on; entity via topology identity |
| Detection rules | LOG body regex: `auth\|unauthorized\|forbidden\|401\|403` → rule `otel.log.auth_failure`, `category: SECURITY` |
| UI | Indirect via alerts; Logs explorer is Phase 6 product (not Security centre) |
| Response capability | Alert generation only when `OPSWATCH_OTEL_ALERT_GENERATION_ENABLED` |
| Runtime verification | Phase 3/6 OTEL / logs-apm tests |
| Current limitation | Heuristic only; gated; **not** identity baseline or threat detection product |

Redaction: `otel-redaction.ts`, `logs-apm/log-redaction.ts` — protects secrets in telemetry, not threat detection.

### 8. Logs / APM evidence

| Aspect | State |
| --- | --- |
| Source | Phase 6 writers for logs/spans/APM windows + evidence links |
| Persistence | `LogRecord`, `SpanRecord`, `Apm*Window`, `*EvidenceLink` |
| Correlation | Alerts/incidents can link evidence |
| Detection rules | Operational (errors, latency) — auth heuristic above is the only SECURITY-ish path |
| UI | Logs/APM product surfaces (not Security page) |
| Response capability | Remediation via Phase 7 ops actions |
| Runtime verification | Phase 6 inventories/tests |
| Current limitation | Evidence for **ops** health; Phase 8 must not treat APM alone as threat coverage |

### 9. URL / SSL / DNS / security-header checks

| Aspect | State |
| --- | --- |
| Source | URL onboarding provisions HTTP + SSL (`url-monitoring-provisioning.service.ts`); worker `run-ssl-checks.job.ts` (TLS connect + cert `valid_to`); HTTP checks classify DNS/TLS failures (`packages/shared/src/failure-classification.ts`); agentless probe classifies `DNS_FAILED` / `TLS_FAILED` |
| Persistence | `Check` (`CheckType.SSL` etc.), `CheckResult`, alerts |
| Correlation | Legacy service → canonical entity mapping on SSL alerts |
| Detection rules | SSL warn &lt;30d, critical &lt;7d; HTTP DNS/TLS classes |
| UI | Checks / health / project monitoring; register wizard “SSL check scheduled” |
| Response capability | `RERUN_SSL_CHECK` remediation; diagnosis maps SSL/CERT |
| Runtime verification | `url-only-onboarding.database-e2e`, `verify-live-monitoring.ts`, SSL job runtime |
| Current limitation | SSL alerts use **`DEPENDENCY_CHANGE`**, not `SECURITY`. **No DNS product check** (manifest foundationHooks `dns`/`tls` = unsupported for connector probing). **`DOMAIN_EXPIRING` enum exists** but no dedicated domain-expiry job found. **Zero security-header (HSTS/CSP/X-Frame) checks**. Outbound SSRF guard exists: `packages/shared/src/outbound-url-safety.ts` |

Empty stub: `apps/api/src/services/health-checks/ssl-check.service.ts` is `export {};` — real work is in the worker job.

### 10. Alerts and incidents (security classification)

| Aspect | State |
| --- | --- |
| Source | `AlertCategory` enum includes `SECURITY`; set by `events.service.ts` for `AUTH_SPIKE`, `AUTH_FAILURE_SPIKE`, `TRAFFIC_SPIKE`, `WEBHOOK_SIGNATURE_FAILED`; OTEL auth logs; AI diagnosis can return `SECURITY` |
| Persistence | `Alert.category`; incidents **have no security category field** |
| Correlation | Standard alert→incident correlation; OTEL evidence gated |
| Detection rules | Spike thresholds: `AUTH_FAILURE_SPIKE_THRESHOLD` (default 10), `EVENT_SPIKE_WINDOW_MINUTES` (default 5) — **only if client already sends spike event types** |
| UI | Alert detail shows `category`; no Security-filtered Command Centre |
| Response capability | Generic remediation/automation — **no containment** |
| Runtime verification | `incident-ai.service.test.ts` (AUTH_FAILURE_SPIKE → SECURITY diagnosis); events ingest path |
| Current limitation | Category label ≠ threat product; no risk score; incidents not security-typed; spike detection does not invent auth failures from login logs |

### 11. Canonical topology

| Aspect | State |
| --- | --- |
| Source | Phase 4/5 graph (`OperationalEntity` / `OperationalRelationship`); OTEL identity/dependency |
| Persistence | Canonical graph + legacy mappings |
| Correlation | Alerts/incidents can attach entity/relationship IDs |
| Detection rules | None security-specific |
| UI | Topology drawers; hierarchy “containment” = **structural**, not threat containment |
| Response capability | Phase 7 automation on dependency edges only |
| Runtime verification | Topology integrity / unification inventories |
| Current limitation | No attack-path graph; no asset exposure scoring; hierarchy containment must not be confused with Phase 8 containment |

### 12. Credential lifecycle events

| Aspect | State |
| --- | --- |
| Source | `managed-credential.service.ts`, `connection-credential.service.ts`, `project-ingest-credentials.service.ts`, worker `expire-credentials.job.ts` |
| Persistence | `ManagedCredential` statuses (`ACTIVE`/`GRACE`/`EXPIRED`/…); connection health on expiry |
| Correlation | `recordCredentialAudit` actions: `CREDENTIAL_*`, `AUTH_FAILED`, `CONNECTION_TESTED`, … |
| Detection rules | Expiry job marks expired/grace; warn expiring-soon connections |
| UI | Connections + credential status helpers; org API keys |
| Response capability | Rotate webhook secret / connection rotate remediation; disconnect on expiry |
| Runtime verification | `credential-security*.spec.ts`, managed-credential tests, Phase 2 inventory |
| Current limitation | Platform credential hygiene **≠** application threat findings |

### 13. Deployment / change events

| Aspect | State |
| --- | --- |
| Source | `ChangeEvent`, `ChangeLedgerEntry` (`DEPLOYMENT`, `CONFIGURATION`, …), `DeploymentRecord`, Vercel/GitHub/Render webhooks, heartbeats with commit metadata |
| Persistence | As above; intelligence deployment pages |
| Correlation | Incident causal graph maps deploy-like change events |
| Detection rules | None security-specific (change for blast-radius / causality) |
| UI | `projects/[projectId]/deployments`, topology live ops feed |
| Response capability | `ROLLBACK_DEPLOYMENT` (Phase 7, approval-gated) |
| Runtime verification | Webhook routes tests; change-ledger controllers |
| Current limitation | Useful **context** for Phase 8 privilege/change correlation; not vulnerability or threat detection |

### 14. Automation actions / Phase 7 remediation (security-adjacent)

| Aspect | State |
| --- | --- |
| Source | `REMEDIATION_REGISTRY` / universal registry — see `docs/phase7-remediation-inventory.md` |
| Security-adjacent actions | `RERUN_SSL_CHECK`, `ROTATE_WEBHOOK_SECRET`, `DISABLE_INTEGRATION`, `RETRY_WEBHOOKS`, connection disable/test/reenable |
| Persistence | `RemediationLog`, `AutomationRun*`, `RemediatorRepairAttempt` |
| Correlation | Alert/incident/timeline |
| Detection rules | N/A (response path) |
| UI | Topology drawer, alert automation panels, Automation workspace |
| Response capability | Observe / Approval / Autonomous governance |
| Runtime verification | Phase 7 tests including `phase7-security.test.ts` (secret redaction + risk gates — **not** threat product) |
| Current limitation | **No containment actions** (isolate host, block IP, revoke app user, quarantine workload). Payment retry deliberately disabled. Do not rebrand heal as containment |

### 15. User / session models

| Aspect | State |
| --- | --- |
| Source | `User` (`role` string, `isActive`, org FK); `UserSession`; platform super-admin flag |
| Persistence | Prisma models above |
| Correlation | Audit on role/password/deactivate |
| Detection rules | Last-admin protection in user-management |
| UI | `/members`, `/settings` |
| Response capability | Session revoke on privilege/password changes |
| Runtime verification | Session + user management paths |
| Current limitation | Roles are OpsWatch RBAC, not monitored **customer-app** identity; no session anomaly product |

Assignable roles: `ADMIN`, `MEMBER`, `VIEWER`, `INCIDENT_RESPONDER`, `AUTOMATION_OPERATOR`. Permission matrix: `apps/api/src/auth/permissions.ts`.

### 16. Existing security enums and placeholder UI

| Item | Location | Real vs placeholder |
| --- | --- | --- |
| `AlertCategory.SECURITY` | `schema.prisma` | Real enum; used by events/OTEL/AI |
| `EventType` security-ish values | `AUTH_SPIKE`, `AUTH_FAILURE_SPIKE`, `WEBHOOK_SIGNATURE_FAILED`, `SSL_EXPIRING`, `DOMAIN_EXPIRING`, `TRAFFIC_SPIKE` | Enums real; writers mostly **external ingest** or SSL job (SSL→DEPENDENCY_CHANGE) |
| Shared `EventType` | `packages/shared/src/enums.ts` | **Stale subset** (missing newer Prisma values) |
| Failure classes | `DNS_FAILURE`, `TLS_FAILURE`, auth→SECURITY in `failure-classification.ts` | Real for HTTP diagnosis |
| Entitlements | `security.mtls.enabled`, `security.sso.enabled` | Plan flags only — **no SSO/mTLS product path** |
| Security page | `/security` | Foundation placeholder |
| Connection foundationHooks dns/tls | `connection-manifest.service.ts` | Explicitly unsupported |

### 17. Provider manifests

| Manifest | Auth methods / security notes |
| --- | --- |
| `connection-manifest.service.ts` | Modes declare `HMAC`, `API_KEY`, `MTLS`, `OAUTH2` etc.; foundationHooks mark dns/tls/database/queue as **not implemented** |
| Remediator / integration types | `IntegrationType` includes remediator providers; signing secrets managed (Phase 2/7) |
| Retail fixture | `retail-checkout.fixture.ts` — payment outage scenario; **no security findings seeded** |

### 18. Security-related tests

| Area | Paths |
| --- | --- |
| Auth / session | `auth.service.test.ts`, `auth.session.test.ts`, `session.database-e2e.test.ts`, `e2e/smoke/01-auth-session.spec.ts` |
| API keys / credentials | `middleware/auth.test.ts`, `credential-security.database-e2e.test.ts`, `e2e/credential-security-api-keys.spec.ts`, `e2e/credential-security-connections.spec.ts` |
| Permissions | `auth/permissions.test.ts` |
| Rate limit | `middleware/rate-limit.test.ts` |
| Webhooks / ingest | `webhooks.routes.test.ts`, `ingest-replay*.test.ts`, otel-bridge auth/replay tests |
| SSL / URL | `url-monitoring-provisioning.service.test.ts`, `url-only-onboarding.database-e2e.test.ts`, failure-classification tests |
| Product truth Security UI | `e2e/phase5-product-truth.spec.ts` |
| Phase 7 “security” | `remediation/phase7-security.test.ts` (redaction/risk — not threat) |
| Outbound safety | `packages/shared/src/outbound-url-safety.test.ts` |

**Missing:** any `*security-finding*`, `*threat*`, containment, or risk-score tests.

### 19. Seeded or demo findings

| Finding | State |
| --- | --- |
| Security Command Centre demos | **None** — Phase 5 explicitly forbids seeded threat claims |
| Retail fixture | Ops/payment cascade only |
| Product insights | May flag “demo or invalid monitoring data” hygiene — not security findings |
| Eval cases | `packages/shared/src/evals/incident-diagnosis-cases.json` includes `AUTH_FAILURE_SPIKE` for diagnosis evals |

---

## Cross-cutting detection rules (what exists today)

| Rule / heuristic | Where | Output |
| --- | --- | --- |
| Auth failure spike threshold | `events.service.ts` | Alert if N× `AUTH_FAILURE_SPIKE` in window |
| Traffic spike threshold | same | Alert (`SECURITY` category — questionable) |
| OTEL log auth regex | `otel-policy.service.ts` | SECURITY alert (flag-gated) |
| SSL days remaining | `run-ssl-checks.job.ts` | DEPENDENCY_CHANGE alert |
| HTTP DNS/TLS/401 classification | `failure-classification.ts` | Diagnosis category; 401 → SECURITY |
| API key expire/revoke/rate/env/scope | `middleware/auth.ts` | Reject + audit |
| Ingest signature / replay | `ingest-replay.ts` + controllers | Reject + log |

None of these write a first-class security finding entity.

---

## Response capability matrix (honest)

| Capability | Status |
| --- | --- |
| Platform access control (session, CSRF, RBAC) | Real |
| Credential encrypt/rotate/revoke/expire | Real (Phase 2+) |
| Ops remediation (SSL rerun, rotate webhook, disable integration) | Real / Phase 7 |
| Alert category SECURITY | Real label on some paths |
| Threat findings UI | Placeholder |
| Vulnerability / attack-path / risk score | **Absent** |
| Approved containment | **Absent** |
| Identity baselines for monitored apps | **Absent** (only OpsWatch users) |
| Security-header / DNS product monitors | **Absent** |
| Security Coverage depth labels | **Absent** |

---

## Gaps Phase 8 must close

1. Introduce verified security-event / finding / occurrence / evidence-link models + writers (no fake seeds).
2. Security-event ingestion via scoped API keys, signed webhooks, OTEL/log evidence, internal audit bridges, URL monitors — with redaction, idempotency, replay protection.
3. Deterministic detection rules (identity, API, application, business) producing explainable findings.
4. Rolling baselines with honest wording (“Above normal”, “Insufficient baseline data”) — not prediction.
5. External attack-surface checks (TLS, DNS, headers, exposed admin/diagnostic) with SSRF protection.
6. Threat correlation sequences and evidence-based attack-path views (Confirmed / Suspected / Possible / Insufficient evidence).
7. Wire findings into existing alert/incident engine; security topology overlay (separate from operational health).
8. Honest Security Coverage UI + Security workspace replacing Foundation page.
9. Governed security response via Phase 7 registry (revoke OpsWatch API key, disable test integration, quarantine webhook, open security incident) with verification.
10. False-positive / accepted-risk / suppression with audit; rule management; retention; privacy and security roles.
11. Acceptance tests + runtime/browser evidence under `test-artifacts/phase8-security/`; local commits; no push without approval.

---

## Explicit non-goals (this inventory)

- Implementing Phase 8 product code in the inventory commit
- Native Datadog / Dynatrace connectors
- Phase 9 learning / predictive threat modelling
- Claiming Security Command Centre complete
- Treating hierarchy “containment” edges as threat containment
- Seeded vulnerability / attack-path demos
- Malware scanning, packet inspection, full SIEM, or penetration testing

---

## Suggested follow-on commits

1. Security schema and ingestion
2. Detection rules and findings
3. Threat correlation and attack paths
4. Incident/topology integration
5. Governed security response
6. Security Coverage and workspace UI
7. Privacy/roles/retention
8. Tests and verification fixes
