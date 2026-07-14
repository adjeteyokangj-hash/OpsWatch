# Intelligence release checklist (local batch)

Use before any production push. **Do not push until the owner explicitly requests it.**

## Production env verify (mandatory — do not skip)

Confirm these in the **production** host (Vercel / platform dashboard). **Do not change production env vars from this checklist** — only verify, and flag mismatches for a separate approved change.

- [ ] **`OPSWATCH_PREDICTIONS_ENABLED`** is **unset** or exactly **`false`** (never `true` for this release)
- [ ] Record where verified (Vercel project env / runtime) and by whom
- [ ] If the flag is `true` accidentally, **stop ship** until it is corrected under explicit approval
- [ ] Local `.env` matches intent: `OPSWATCH_PREDICTIONS_ENABLED=false`

Automated gate coverage (local):

```bash
pnpm --filter @opswatch/api exec vitest run src/services/intelligence/prediction-gate.service.test.ts
```

## Predictions stay disabled

- [ ] `OPSWATCH_PREDICTIONS_ENABLED` is unset or `false` in deployed env *(see mandatory verify above)*
- [ ] `/intelligence` shows Prediction readiness as Disabled / not emitting
- [ ] Dashboard risk slot shows **Not ready** (no fabricated risk %)
- [ ] Application **AI Insights** tab does not show predictive claims
- [ ] No UI copy claims live failure/degradation predictions as truth
- [ ] Learning / baselines / patterns still ingest with predictions off (no autonomous prevention)

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

- [ ] Tabs present: Overview, Modules, Workflows, Components, Topology, Incidents, Alerts, Automation, Intelligence, Configuration
- [ ] Legacy Services → Components redirect; Metrics/Logs/Deployments reachable from Configuration
- [ ] Project Automation stats come from `/intelligence/automation-history` (no hardcoded success %)
- [ ] Logs (`/log-streams`) shows honest “not connected” empty state
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

## Heartbeat freshness

- [ ] Follow `docs/heartbeat-verification.md` (5m cadence; 10m/20m stale; Hobby cron limits)
- [ ] External scheduler used if Vercel Hobby cannot run 5‑minute cron

## Local verification

```bash
pnpm --filter @opswatch/api exec prisma generate
pnpm --filter @opswatch/api test -- src/services/intelligence
pnpm --filter @opswatch/api typecheck
pnpm --filter @opswatch/web test -- src/components/alerts/alert-grouping.test.ts
pnpm --filter @opswatch/web typecheck
pnpm lint   # must be 0 errors and 0 warnings
```

## Push gate

- [ ] All related commits are local only
- [ ] Owner requested a **single** production push
- [ ] Run migrations (`20260714170000_intelligence_foundation`) against production DB before or with deploy
- [ ] Production env verify section completed (predictions flag)
