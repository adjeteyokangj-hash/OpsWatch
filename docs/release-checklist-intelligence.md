# Intelligence release checklist (local batch)

Use before any production push. **Do not push until the owner explicitly requests it.**

## Predictions stay disabled

- [ ] `OPSWATCH_PREDICTIONS_ENABLED` is unset or `false` in deployed env
- [ ] `/intelligence` shows Prediction readiness as Disabled / not emitting
- [ ] Dashboard risk slot shows **Not ready** (no fabricated risk %)
- [ ] Application **AI Insights** tab does not show predictive claims
- [ ] No UI copy claims live failure/degradation predictions as truth

## Confidence / evidence gates

- [ ] Patterns below `OPSWATCH_MIN_DISPLAY_CONFIDENCE` are stored but not shown as actionable
- [ ] Recommendations require `OPSWATCH_MIN_RECOMMENDATION_CONFIDENCE` (see `assertRecommendationAllowed`)
- [ ] Empty / learning banners appear when evidence is insufficient
- [ ] Portfolio **Risk (evidence)** column only reflects open alerts/incidents/health — never a invented score

## Topology / performance

- [ ] Topology loads without timeout (batching + soft cache intact)
- [ ] Live traffic animation, replay, and filters still work
- [ ] Empty/loading/error states render honestly
- [ ] Application panel shows when no node selected; node drawer when selected
- [ ] Intelligence harvest on `/intelligence` does not reintroduce N+1 check-result queries on topology

## Application workspace tabs

- [ ] Tabs present: Overview, Topology, Modules, Workflows, Services, Incidents, Alerts, Deployments, Automation, Metrics, Logs, AI Insights, Settings
- [ ] Project Automation stats come from `/intelligence/automation-history` (no hardcoded success %)
- [ ] Logs tab shows honest “not connected” empty state
- [ ] Deployments tab shows change events / intelligence records only

## Incidents / Alerts

- [ ] Incidents list shows owner, scope, alert count, deploy correlation from API
- [ ] Incident quick drawer opens from list without fabricating root cause
- [ ] Alerts group mode uses exact title+source+service signature
- [ ] Alert first/last seen + linked incident columns show real joins only

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
pnpm --filter @opswatch/web test -- src/components/alerts/alert-grouping.test.ts
pnpm --filter @opswatch/web typecheck
```

## Push gate

- [ ] All related commits are local only
- [ ] Owner requested a **single** production push
- [ ] Run migrations (`20260714170000_intelligence_foundation`) against production DB before or with deploy
