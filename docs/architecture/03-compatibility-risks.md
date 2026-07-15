# 03 — Compatibility Risks

**Phase:** 1 assessment  
**Example customer:** Noble Express (first demonstration target only)  
**Rule:** Do **not** accumulate hard-coded Noble / logistics debt in core schema, enums, routes, or UI. Treat every domain customer as a swappable profile.

This document is **not** an inventory of Noble codepaths. It is a risk register for making OpsWatch universal while using Noble as the first integration example.

---

## 1. What works well for Noble (and any SaaS)

Noble’s demo journey already maps to **generic** OpsWatch primitives:

- Project + Services + Checks + Dependencies + SLO + Notification channel  
  See `docs/noble-express-monitoring-journey.md`.

- Signed heartbeat/event ingest via `@opswatch/client`.
- Agentless HTTP check against a real health endpoint.
- Incident correlation, dependency evidence, notifications, recovery.

**Implication:** Noble can be onboarded with **zero** Noble-specific models if teams stay disciplined.

---

## 2. Risk register

### R1 — Domain-coloured `EventType` values

**Evidence:** Prisma / shared enums include logistics-ish values (`BOOKING_FAILED`, `PAYMENT_FAILED`, `GOOGLE_API_FAILED`, …).

| Risk | If we expand enums per customer, core becomes a freight taxonomy. |
|------|-------------------------------------------------------------------|
| Symptom | New industry requires schema migration for every event vocabulary. |
| Mitigation | Prefer extensible string `eventKey` / category taxonomy; keep reserved system events (deploy, heartbeat missed, SSL, etc.). Domain packs as **Monitoring Profiles** or payload conventions. |
| Phase | 2–3 (Universal Connection / Adaptive Graph signals) |

### R2 — “Application” language conflated with multi-branch Systems

**Evidence:** Product UI “Applications” = `Project`; no Location.

| Risk | Multi-depot / multi-branch Noble (or retail) customers cannot express “same app, many sites”. |
|------|-----------------------------------------------------------------------------------------------|
| Symptom | Operators clone projects per branch (duplicated topology) or over-collapse health into one org roll-up. |
| Mitigation | Location entity + System↔Location assignment; Centralised / Distributed / Hybrid modes ([08](./08-branch-aware-location-design.md)). |
| Phase | 3 (Locations) + health roll-up updates |

### R3 — Remediation executors that assume web SaaS shape

**Evidence:** Executors such as retry emails/webhooks, restart worker, rollback deployment — fine for Noble-like apps; not universal industrial actions.

| Risk | Playbooks imply every System is a Node/web service. |
|------|-----------------------------------------------------|
| Symptom | Empty “Recommended actions” or unsafe generic restarts on non-SaaS Systems. |
| Mitigation | Action catalogues keyed by System/Module profile; industry packs register actions; keep OBSERVE default. |
| Phase | 7–8 (automation safety) |

### R4 — Docs and marketing naming “OkangGroup apps”

**Evidence:** AI Brain / onboarding docs reference OkangGroup / Noble / StarLiz / TrueNumeris.

| Risk | Implementers copy example names into core conditionals or seed data permanently. |
|------|----------------------------------------------------------------------------------|
| Symptom | `if (project.slug === 'noble-…')` style debt. |
| Mitigation | Examples stay in `docs/` and optional Monitoring Profiles; CI/review gate forbids customer slug hard-coding. |
| Phase | Ongoing; checklist gate in [06](./06-implementation-checklist.md) |

### R5 — TrueNumeris / StarLiz route leftovers

**Evidence:** `apps/api/src/routes/truenumeris.routes.ts` exists.

| Risk | Cross-product coupling and accidental production behaviour coupling. |
|------|----------------------------------------------------------------------|
| Mitigation | Isolate behind experiment/feature flag; never expand Phase 1–2 work into those remotes; prefer deprecate or genericise later. |
| Constraint | **Do not touch StarLiz/TrueNumeris/Noble remotes** in this programme’s Phase 1. |

### R6 — Entitlements / plans shaped for current SaaS pilot

| Risk | Limits named `monitoring.applications.max` may not match “sites × systems” commercial model. |
|------|-----------------------------------------------------------------------------------------------|
| Mitigation | Add location/system counters later; keep aliases. |
| Phase | 3 + billing follow-on |

### R7 — Topology UI heuristics for COMPONENT roles

**Evidence:** Visual layer helpers classify COMPONENT into SERVICE / INFRASTRUCTURE / EXTERNAL by name heuristics.

| Risk | Heuristics tuned to web apps misclassify warehouse/IoT/device components. |
|------|----------------------------------------------------------------------------|
| Mitigation | Explicit component role metadata on Service; heuristics as fallback only. |
| Phase | 4 (Adaptive Operational Graph) |

### R8 — Predictions enabled too early for sparse multi-site data

| Risk | Per-site sparse telemetry still “READY” if org aggregate looks strong. |
|------|-----------------------------------------------------------------------|
| Mitigation | Keep `OPSWATCH_PREDICTIONS_ENABLED` off; when on, require scope-aware confidence (site vs org). |
| Phase | 5–6 (intelligence) — gate remains non-negotiable |

---

## 3. Noble-as-example acceptance criteria (platform)

Noble onboarding is **successful** when:

1. All entities created are generic Projects/Services/Checks/SLOs.
2. No Noble-only Prisma enum value, route, or page is required.
3. Failure→alert→incident→recovery demo uses worker-created records only (`docs/noble-express-monitoring-journey.md`).
4. Multi-site future is **not** blocked by schemas that assume “one Project = one company”.

---

## 4. Explicit non-goals of this risk doc

- No exhaustive file-by-file Noble debt list.
- No schema change in Phase 1.
- No remote changes to Noble Express repository.
