# Phase 8 — Security and threat foundation verification

Date: 2026-07-20  
Baseline start: `47bd5b49642a25d8f662f4820edbc616fe90ff42`  
Inventory: `docs/phase8-security-threat-inventory.md`

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. Phase 8 adds evidence-based security
monitoring and governed response. It does **not** predict attacks.

## Local commits

1. `4c03c6f` docs: inventory security and threat foundations
2. `4a75388` feat(security): Phase 8 schema and event ingestion
3. `0fee280` feat(security): detection rules and grouped findings
4. `a0fb65e` feat(security): threat correlation and attack paths
5. `6a3e39f` feat(security): incident and topology security integration
6. `5ef018b` feat(security): governed security response actions
7. `57d079c` feat(web): Security Coverage and findings workspace
8. `2e1b18b` feat(security): privacy roles and retention
9. (this) test(security): Phase 8 verification evidence

## Test counts (local)

| Suite | Result |
| --- | --- |
| `src/services/security` unit (ingest/detection/response) | **14 passed**, 1 skipped (DB e2e gated) |
| `security.database-e2e.test.ts` with `RUN_DATABASE_E2E=true` | **1 passed** |
| `permissions.test.ts` (includes security role mapping) | **5 passed** (run with security units earlier: 16 with permissions) |
| API `tsc --noEmit` | **exit 0** |
| Migration `20260720090000_phase8_security_threat_foundation` | **applied** locally |

Combined focused security + permissions unit run earlier: **16 passed**.


```text
pnpm typecheck
# Windows PowerShell:
$env:NODE_ENV='test'; pnpm test
pnpm --filter @opswatch/api exec vitest run src/services/security
$env:RUN_DATABASE_E2E='true'; pnpm --filter @opswatch/api exec vitest run src/services/security/security.database-e2e.test.ts
pnpm lint
pnpm build
$env:RUN_BROWSER_E2E='true'; pnpm --filter @opswatch/web exec playwright test e2e/phase8-security.spec.ts
```

## Evidence directory

`test-artifacts/phase8-security/`

Expected browser shots (when Playwright runs with stack up):

- 01-security-not-configured
- 02-security-coverage
- 03-open-findings
- 18-mobile-security

Additional shots (04–17) are captured when fixture findings/incidents/responses exist in the local org.

## Acceptance notes

- Security events persist via scoped ingest with redaction and idempotency.
- Deterministic rules create grouped findings (not one alert per raw event).
- Threat sequences correlate ordered evidence without causation claims.
- Findings attach to existing incident engine with `classification=SECURITY`.
- Topology security overlay is separate from operational health.
- Security Coverage is honest (BASIC/STANDARD/ADVANCED/DEEP / NOT_CONFIGURED).
- Governed response reuses Phase 7 patterns; verified local action: revoke OrgApiKey.
- False-positive / accepted-risk / suppression retain evidence.
- Viewer roles lack `security:read`; INCIDENT_RESPONDER cannot approve high-risk / manage credentials.
- Nothing pushed or deployed in this phase.
