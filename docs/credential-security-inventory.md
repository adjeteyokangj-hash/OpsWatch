# Credential Security Inventory (Phase 2)

Inventory date: 2026-07-19  
Baseline commit: `8cfb715967ab79e389c9dc6e3e70b84c1ce3a7a8`  
Status: inventory complete; implementation must close the gaps below before Phase 3.

This document locks the audit of OpsWatch credential paths before Phase 2 code
changes. UI placeholders and schema fields alone do not count as implemented
capabilities.

## Cryptographic primitives

| Mechanism | Location | Notes |
|-----------|----------|-------|
| AES-256-GCM encrypt/decrypt | `apps/api/src/lib/secret-crypto.ts` | Random 12-byte IV; key = SHA-256 of `OPSWATCH_SECRETS_ENCRYPTION_KEY` with `JWT_SECRET` fallback. No key version, no AAD. |
| Worker AES-GCM decrypt | `apps/worker/src/lib/connection-auth.ts` | Duplicate of API decrypt path. |
| API-key hash | `apps/api/src/utils/crypto.ts` (`sha256`) | Unsalted SHA-256 of high-entropy secret. |
| HMAC ingest/webhook | `apps/api/src/lib/request-signature.ts` | HMAC-SHA256 (ingest/remediator/GitHub/Render), HMAC-SHA1 (Vercel). Timing-safe compare. |
| Password hash | `apps/api/src/services/auth.service.ts` | bcrypt cost 10. |
| Session/CSRF hash | `apps/api/src/services/session.service.ts` | Unsalted SHA-256. |

## Path inventory

### 1. Project.signingSecret

| Attribute | Current state |
|-----------|---------------|
| Storage | `Project.signingSecret` plaintext column (`schema.prisma`) |
| Encryption/hashing | None |
| Retrievable | Yes — any DB reader |
| API exposure | Stripped from list/get via `normalizeProjectRow`. Returned on create/patch through `ingestCredentials.signingSecret`, including reused-key paths |
| UI exposure | Register wizard shows once in-session; API can re-emit on later patch |
| Rotation | `executeRotateWebhookSecret` overwrites; does not return new secret; no grace period |
| Revocation | None |
| Expiry | None |
| Audit | Rotation audited as `ROTATE_WEBHOOK_SECRET`; create/reuse not audited as credential lifecycle |
| Ownership | `Project.organizationId`, `Project.environment` |

**Root cause:** signing secret was modelled as a durable project column and treated as a reusable provisioning field rather than a one-time managed credential.

### 2. Project.apiKey (legacy)

| Attribute | Current state |
|-----------|---------------|
| Storage | `Project.apiKey` plaintext unique column |
| Encryption/hashing | None |
| Retrievable | Yes |
| API exposure | Stripped from project DTOs |
| UI exposure | None for auth |
| Rotation / revocation / expiry | None |
| Ownership | Project / organization |

**Root cause:** leftover from pre-`OrgApiKey` auth; still generated on project create but unused by `authorizeApiKey`.

### 3. OrgApiKey (inbound OpsWatch keys)

| Attribute | Current state |
|-----------|---------------|
| Storage | `OrgApiKey.secretHash`, `keyId`, scopes JSON, environment, projectId, expiresAt, revokedAt, lastUsed* |
| Encryption/hashing | SHA-256 of secret; plaintext never stored |
| Retrievable | No after create |
| API exposure | Full `keyId.secret` once on create; list returns metadata only |
| UI exposure | Org page create-once + revoke; expiry date not shown in table |
| Rotation | Manual create + revoke only |
| Revocation | Soft revoke with optional reason |
| Expiry | Stored and used for UI status / provision queries; **not enforced in `authorizeApiKey`** |
| Audit | No create/revoke/use/failure audits |
| Ownership | `organizationId`, optional `projectId`, `environment` label |

**Root causes:** auth middleware never checks `expiresAt`, never updates `lastUsed*`, never rate-limits per key, does not enforce environment binding, and uses ordinary string compare for hashes. Usage counters in list/usage endpoints are stubbed to zero.

### 4. Connection.secretRef and managed ciphertext

| Attribute | Current state |
|-----------|---------------|
| Storage | `Connection.secretRef`; `managedSecretCiphertext` / `Iv` / `AuthTag` |
| Encryption/hashing | AES-GCM for managed triple; `secretRef` supports `env://VAR` only |
| Retrievable | Managed secret decryptable server-side; env refs resolve from process env |
| API exposure | `secretConfigured` boolean only (`toConnectionDto`) |
| UI exposure | Write-only password + optional env ref; cleared after save |
| Rotation | Admin `rotate-credential` encrypts new value and clears `secretRef` |
| Revocation | Connection deactivate/delete; no credential-version revoke |
| Expiry | None on credential |
| Audit | Create/update/rotate/deactivate events exist; no version history |
| Ownership | `organizationId`, optional `projectId`, `environment` |

**Root causes:** single in-place ciphertext without version/key-id/expiry/revocation; inbound OTEL and signed-webhook controllers resolve only `secretRef`, so managed rotation breaks inbound verification while outbound probes still succeed.

### 5. Webhook connection secrets (signed ingest)

| Attribute | Current state |
|-----------|---------------|
| Storage | Same Connection fields |
| Runtime | `connection-ingest.controller.ts` uses `resolveConnectionSecretReference(secretRef)` only |
| Managed ciphertext | Not selected / not used for inbound HMAC |
| Expiry / rotation / grace | None beyond Connection rotate |

**Root cause:** inbound path never updated when managed ciphertext was added.

### 6. OpenTelemetry connection credentials

| Attribute | Current state |
|-----------|---------------|
| Storage | Same Connection fields |
| Runtime | `otel-bridge.controller.ts` uses `secretRef` only; HMAC or static `X-OpsWatch-Connection-Key` |
| Managed ciphertext | Not used for inbound auth |
| Environment | Connection environment matched to telemetry `deployment.environment` |

**Root cause:** same managed-vs-`secretRef` split as webhook ingest.

### 7. Remediator signing secrets

| Attribute | Current state |
|-----------|---------------|
| Storage | Encrypted `_remediatorSecretEnc` inside `ProjectIntegration.configJson`; optional `secretRef`; legacy plaintext key still accepted |
| Encryption/hashing | AES-GCM via remediator-config helpers |
| Retrievable | Server-side for outbound HMAC |
| API exposure | Config redacted to `secretConfigured`; **`secretRef` still returned** by `serializeIntegrationRow` |
| UI exposure | Write-only remediator secret field |
| Rotation / revocation / expiry | Blank-preserve update; no versioned rotation/expiry |
| Ownership | Via project → organization; no explicit environment on integration |

**Root cause:** secrets embedded in JSON blobs rather than a first-class managed credential with version lifecycle.

### 8. Provider API keys (legacy ProjectIntegration)

| Attribute | Current state |
|-----------|---------------|
| Storage | `ProjectIntegration.configJson` / `secretRef` |
| Encryption/hashing | Remediator path encrypted; other providers historically plaintext |
| Retrievable | Possible for legacy rows |
| API exposure | Remediator keys redacted; non-remediator secret-bearing config may leak |
| UI exposure | Provider forms; project Stripe writes return 410 |
| Ownership | Project-scoped |

**Root cause:** integration config was a free-form JSON bag before managed secrets existed; migration never converted historical plaintext.

### 9. Environment-variable-only credentials

| Credential | Location | Ownership |
|------------|----------|-----------|
| `DATABASE_URL` / `DIRECT_URL` | API/worker env | Deployment |
| `JWT_SECRET` | API env | Deployment; also encrypt fallback |
| `OPSWATCH_SECRETS_ENCRYPTION_KEY` | API/worker env | Deployment |
| `VERCEL_WEBHOOK_SECRET` / `GITHUB_WEBHOOK_SECRET` / `RENDER_WEBHOOK_SECRET` | API env + `webhook-auth.ts` | Global platform |
| `WORKER_INTERNAL_SECRET` | API/worker; string equality compare | Deployment |
| `OPENAI_API_KEY`, SMTP creds, Stripe env fallbacks | env | Deployment |
| `OPSWATCH_HEARTBEAT_API_KEY` / `_SIGNING_SECRET` | worker self-monitor | Deployment |
| `SEED_ADMIN_PASSWORD` | seed/bootstrap | Deployment |
| Arbitrary `env://NAME` refs | Connection / remediator | Process env |

**Root cause:** platform secrets are deployment-owned and lack org/app lifecycle metadata. They must remain distinct from organization-managed credentials and must not be presented as UI-rotatable app secrets.

### 10. Legacy TrueNumeris paths

| Path | Behavior |
|------|----------|
| `truenumeris.routes.ts` register | Uses `OrgApiKey` with `events:write`; creates plaintext project `apiKey`/`signingSecret`; stores URLs in integration config |
| Guided Connection profile | TrueNumeris bearer enters as Connection `authSecret` → AES-GCM managed fields |

**Root cause:** register endpoint still creates legacy project plaintext credentials instead of managed signing + OrgApiKey-only inbound auth.

### 11. Platform Stripe settings

| Attribute | Current state |
|-----------|---------------|
| Storage | `PlatformStripeSettings` encrypted secret/webhook triples |
| API/UI | Masked last-4; never unmasked |
| Ownership | Global singleton, not organization-owned |
| Expiry / rotation metadata | Absent |

## Root-cause matrix

| Gap | Root cause | Phase 2 target |
|-----|------------|----------------|
| Signing secret plaintext + re-exposure | Column treated as reusable provision field | Managed signing credential; one-time display; metadata-only thereafter |
| OrgApiKey expiry ignored | Auth middleware incomplete | Enforce expiresAt / revokedAt; safe failure reason |
| lastUsed / usage stubs | Fields never written; counters hardcoded | Update on auth; real or removed metrics |
| Connection no version history | In-place overwrite | Versioned ManagedCredential with grace/revoke |
| OTEL/webhook ignore managed secrets | Controllers only read secretRef | Resolve managed versions + grace |
| Integration JSON secrets | Free-form config bag | Managed credential reference; redact secretRef |
| No key version / AAD | Minimal AES-GCM helper | Key version + ownership-bound AAD |
| Env-only platform secrets | Process-global deploy config | Inventory + validation; not org-managed UI secrets |
| Legacy Project.apiKey | Pre-OrgApiKey leftover | Stop new reliance; retain column until migration proven |

## Compatibility constraints for Phase 2

1. Additive migrations only; do not drop `Project.signingSecret`, `Project.apiKey`, Connection ciphertext columns, `secretRef`, or integration JSON secret fields until readers and rollback are proven.
2. Existing heartbeat HMAC verification must continue after encrypting signing secrets.
3. Existing OrgApiKey hashes remain valid; do not re-hash or invalidate active keys.
4. Connection rotate must not leave WEBHOOK/OTEL inbound auth broken.
5. Blank secret updates must preserve existing credentials.
6. No push/deploy without explicit approval.

## Out of Phase 2 scope

- OpenTelemetry operational spine / topology effects (Phase 3+)
- Topology model unification (Phase 4)
- Native Datadog/Dynatrace connectors (Phase 10)
- Making global env-only platform secrets organization-owned UI credentials
