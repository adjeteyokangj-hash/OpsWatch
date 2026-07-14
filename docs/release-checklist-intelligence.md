# Intelligence release checklist (local batch)

Use before any production push. **Do not push until the owner explicitly requests it.**

## Predictions stay disabled

- [ ] `OPSWATCH_PREDICTIONS_ENABLED` is unset or `false` in deployed env
- [ ] `/intelligence` shows Prediction readiness as Disabled / not emitting
- [ ] Dashboard risk slot shows **Not ready** (no fabricated risk %)
- [ ] No UI copy claims live failure/degradation predictions as truth

## Confidence / evidence gates

- [ ] Patterns below `OPSWATCH_MIN_DISPLAY_CONFIDENCE` are stored but not shown as actionable
- [ ] Recommendations require `OPSWATCH_MIN_RECOMMENDATION_CONFIDENCE` (see `assertRecommendationAllowed`)
- [ ] Empty / learning banners appear when evidence is insufficient

## Topology / performance

- [ ] Topology loads without timeout (batching + soft cache intact)
- [ ] Live traffic animation, replay, and filters still work
- [ ] Intelligence harvest on `/intelligence` does not reintroduce N+1 check-result queries on topology

## Surfaces (real data only)

- [ ] `/intelligence` loads org-scoped snapshot
- [ ] `/intelligence/timeline`, `/automation-history`, `/audit` respect permissions
- [ ] Automation Centre shows real run history (or honest empty state)
- [ ] Dashboard Intelligence banner + command section use API data
- [ ] Incident memory root cause only when recorded

## Local verification

```bash
pnpm --filter @opswatch/api exec prisma generate
pnpm --filter @opswatch/api test -- src/services/intelligence
pnpm --filter @opswatch/api typecheck
pnpm --filter @opswatch/web typecheck
```

## Push gate

- [ ] All related commits are local only
- [ ] Owner requested a **single** production push
- [ ] Run migrations (`20260714170000_intelligence_foundation`) against production DB before or with deploy
