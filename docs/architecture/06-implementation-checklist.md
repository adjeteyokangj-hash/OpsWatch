# 06 — Implementation Checklist & Verification Gates

**Phase:** 1 deliverable (gates for Phases 2–10)  
**Rule:** A phase is not COMPLETE until its gate section is checked and verification commands pass locally.

---

## Global gates (every phase)

- [ ] Changes are **local only** unless user explicitly requests push/deploy
- [ ] **No** production behaviour change without feature flag / default-off
- [ ] **No** DB reset; migrations additive only
- [ ] Predictions remain gated: `OPSWATCH_PREDICTIONS_ENABLED` unset/false unless intentional experiment
- [ ] No fake live AI in UI
- [ ] Light theme preserved
- [ ] No hard-coded Noble/StarLiz/TrueNumeris business logic in core
- [ ] Remotes for StarLiz/TrueNumeris/Noble **not** modified
- [ ] Commit message states phase + additive scope

---

## Phase 1 — Assessment (this delivery)

### Deliverables

- [x] Architecture map
- [x] Data model assessment
- [x] Compatibility risks (Noble as example)
- [x] Reusable inventory
- [x] Migration plan 2–10
- [x] Implementation checklist (this file)
- [x] Approach A vs B mapping
- [x] Branch-aware Location design
- [x] Phase 1 confirmation

### Verification

```bash
# Docs present
ls docs/architecture

# No schema migration from Phase 1
git status -- apps/api/prisma
# Expect: no new migration folders from Phase 1 work
```

### Exit

- [x] Docs-only commit
- [x] **Phase 1 COMPLETE**

---

## Phase 2 — Universal Connection Framework

### Checklist

- [ ] Connection DTO + API (ingest + integration + stub OTEL type)
- [ ] Shared enum alignment with Prisma
- [ ] Wizard uses UCF language without breaking HMAC connect
- [ ] Monitoring Profile seed/system JSON (generic)
- [ ] Unit tests for connection credential provision

### Verification commands

```bash
pnpm --filter @opswatch/api test -- project-ingest
pnpm --filter @opswatch/web exec playwright test e2e/connect-journey.spec.ts
```

### Gate

- [ ] Connect e2e green
- [ ] Signing still required by default
- [ ] No Location schema required yet (or if present, unused)

---

## Phase 3 — Locations / Sites

### Checklist

- [ ] Additive `Region` / `Location` / org topologyMode
- [ ] `Project.locationId` nullable
- [ ] Site vs org health roll-up APIs
- [ ] UI: create Location; assign System
- [ ] Centralised / Distributed / Hybrid mode docs + settings

### Verification

```bash
pnpm --filter @opswatch/api test -- layer-health
# Manual: Project with null locationId behaves as today
```

### Gate

- [ ] Existing projects unaffected
- [ ] Site roll-up ≠ org roll-up when multi-location data exists
- [ ] Migration reversible via nullable columns (no destructive drops)

---

## Phase 4 — Adaptive Operational Graph

### Checklist

- [ ] Location-aware topology queries
- [ ] Component role field (additive)
- [ ] Cross-site edges require explicit criticality
- [ ] Topology UI filters

### Verification

```bash
pnpm --filter @opswatch/api test -- topology
pnpm --filter @opswatch/api test -- dependency
```

### Gate

- [ ] Unscoped topology matches pre-Phase-4 behaviour for unbound systems

---

## Phase 5 — OTEL / Approach B

### Checklist

- [ ] OTEL connection type under UCF
- [ ] Receiver auth (API key / mTLS entitlement)
- [ ] Observation derivation from OTEL
- [ ] Retention policy data class

### Verification

```bash
# Agentless regression
pnpm quarantine:verify-monitoring
# OTEL contract tests (to be added in Phase 5)
```

### Gate

- [ ] Customers without OTEL unchanged
- [ ] Entitlement OFF ⇒ OTEL endpoints 402/403

---

## Phase 6 — Change Ledger & RCA

### Checklist

- [ ] Ledger list/filter UX
- [ ] Remediation → ChangeEvent linkage
- [ ] RCA assembly on facts + optional LLM
- [ ] Postmortem export draft

### Verification

```bash
pnpm --filter @opswatch/api test -- incident-causal
pnpm --filter @opswatch/api test -- prediction-gate
```

### Gate

- [ ] Causal graph never invents edges
- [ ] Predictions still DISABLED by default

---

## Phase 7 — SLOs site & org

### Checklist

- [ ] SLO targetType LOCATION / ORGANIZATION
- [ ] Burn job aggregates correctly
- [ ] UI budgets

### Verification

```bash
pnpm --filter @opswatch/worker test -- evaluate-slo
pnpm --filter @opswatch/worker test -- slo.database-e2e
```

### Gate

- [ ] Existing SERVICE SLOs unchanged numerically for single-system projects

---

## Phase 8 — Automation safety

### Checklist

- [ ] Run scoped to Location/System
- [ ] Cross-location high-risk dual approval
- [ ] Maintenance + policy still win over model output
- [ ] OBSERVE default preserved

### Verification

```bash
pnpm --filter @opswatch/api test -- automation
pnpm --filter @opswatch/worker test -- auto-heal
```

### Gate

- [ ] Autonomous job no-ops without entitlement + policy
- [ ] Exclusive locks prevent double-run

---

## Phase 9 — Feature flags

### Checklist

- [ ] Org runtime flags additive model
- [ ] Predictions = env AND flag AND confidence
- [ ] Admin UI for flags (light theme)

### Verification

```bash
pnpm --filter @opswatch/api test -- prediction-gate
# Docs: docs/release-checklist-intelligence.md still applicable
```

### Gate

- [ ] New flags default OFF
- [ ] Entitlements still enforce commercial limits

---

## Phase 10 — Hardening

### Checklist

- [ ] Portfolio Location chips
- [ ] Index/retention review
- [ ] Example industry pack docs (Noble = example)
- [ ] Dual-write shims removed only after soak

### Verification

```bash
pnpm --filter @opswatch/web exec playwright test e2e/release-smoke.spec.ts
pnpm --filter @opswatch/web exec playwright test e2e/org-isolation.spec.ts
```

### Gate

- [ ] Org isolation e2e green
- [ ] Release smoke green
- [ ] Intelligence release checklist predictions OFF

---

## Suggested local verification baseline (any phase)

```bash
# From repo root (pnpm workspace)
pnpm --filter @opswatch/api test
pnpm --filter @opswatch/worker test
pnpm --filter @opswatch/web exec playwright test e2e/release-smoke.spec.ts
```

Exact package filter names may vary with `package.json` `name` fields — adjust if needed.
