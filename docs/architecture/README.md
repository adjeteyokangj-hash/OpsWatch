# OpsWatch Architecture — Phase 1 Assessment

**Phase:** 1 — Architecture assessment & planning  
**Status:** COMPLETE (documentation only)  
**Date:** 2026-07-15  
**Scope:** Local docs under `docs/architecture/`. No schema migrations, no production behaviour changes, no remote pushes.

OpsWatch is a **multi-tenant adaptive ops platform for any industry**. Domain customers (e.g. Noble Express) are first examples only — not hard-coded product assumptions.

## Deliverables

| # | Document | Purpose |
|---|----------|---------|
| 1 | [01-existing-architecture-map.md](./01-existing-architecture-map.md) | Runtime components, data flows, UI/API/worker map |
| 2 | [02-data-model-assessment.md](./02-data-model-assessment.md) | Prisma model inventory vs product hierarchy |
| 3 | [03-compatibility-risks.md](./03-compatibility-risks.md) | Risks using Noble Express as first example only |
| 4 | [04-reusable-inventory.md](./04-reusable-inventory.md) | Services, packages, UI building blocks to extend |
| 5 | [05-migration-plan.md](./05-migration-plan.md) | Additive phases 2–10 outline |
| 6 | [06-implementation-checklist.md](./06-implementation-checklist.md) | Gates and verification commands |
| 7 | [07-approach-a-vs-b.md](./07-approach-a-vs-b.md) | Agentless vs collector/OTEL mapping |
| 8 | [08-branch-aware-location-design.md](./08-branch-aware-location-design.md) | Org → Region → Location → System hierarchy + health roll-up |
| 9 | [09-phase1-confirmation.md](./09-phase1-confirmation.md) | Phase 1 completion report |

## Product hierarchy (target)

```
Organisation
  └── Region (optional)
        └── Location / Branch / Site
              └── System (Application)
                    └── Module
                          └── Workflow
                                └── Component
```

**Deployment modes:** Centralised | Distributed | Hybrid — see [08-branch-aware-location-design.md](./08-branch-aware-location-design.md).

## Non-negotiables (carried into Phase 2+)

- Predictions stay gated (`OPSWATCH_PREDICTIONS_ENABLED` + confidence thresholds).
- No fake live AI.
- Light theme preserved.
- Additive migrations only; no DB resets.
- Industry examples remain interchangeable adapters, not core schemas.
- Do not touch StarLiz / TrueNumeris / Noble remotes from OpsWatch Phase work.

## Related existing docs

- [`../architecture.md`](../architecture.md) — short component list (superseded in detail by this folder)
- [`../ai-brain-technical-specification.md`](../ai-brain-technical-specification.md)
- [`../noble-express-monitoring-journey.md`](../noble-express-monitoring-journey.md)
- [`../real-app-connection.md`](../real-app-connection.md)
