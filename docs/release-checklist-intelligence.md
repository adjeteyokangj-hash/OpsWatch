# Intelligence release checklist (local batch)

Use before any production push. **Do not push until the owner explicitly requests it.**

Choose an explicit AI operating profile first — see [ai-operating-profile.md](./ai-operating-profile.md).

## Production / target env verify (mandatory — do not skip)

Confirm these on the **target** host (local release candidate or production dashboard). **Do not change production env vars from this checklist** — only verify, and flag mismatches for a separate approved change.

- [ ] **`OPSWATCH_AI_OPERATING_PROFILE`** is set intentionally:
  - `ai_led_safe` for the AI-led release candidate (predictions / learning / safe auto-heal resolve on unless overridden)
  - `safety_gated` (or unset) only when you intentionally want opt-in flags
- [ ] Record profile choice, where verified, and by whom
- [ ] Per-flag overrides reviewed (`OPSWATCH_PREDICTIONS_ENABLED=false` etc. only if intentional escape hatches)
- [ ] Local `.env` matches the chosen profile (API + worker companions)

Automated gate coverage (local):

```bash
pnpm --filter @opswatch/api exec vitest run src/services/intelligence/ai-operating-profile.service.test.ts src/services/intelligence/prediction-gate.service.test.ts
```

## Predictions / AI-led honesty

Under **`ai_led_safe`**:

- [ ] `/intelligence` AI Operations Status shows profile **AI-led safe** and Predictions **Active** (unless explicitly overridden off)
- [ ] Topology compact strip matches the same profile
- [ ] Prediction **emission** still requires confidence + evidence (flag on ≠ fake forecasts)
- [ ] No UI copy claims guaranteed failure/attack prediction
- [ ] High-impact repair still approval-gated; Full Autonomous is not the project default

Under **`safety_gated`** (conservative):

- [ ] `OPSWATCH_PREDICTIONS_ENABLED` unset or `false` unless intentional experiment
- [ ] `/intelligence` shows predictions Restricted / not emitting
- [ ] Dashboard risk slot shows **Not ready** (no fabricated risk %)
- [ ] Application **AI Insights** tab does not show predictive claims as live truth

## Confidence / evidence gates

- [ ] Patterns below `OPSWATCH_MIN_DISPLAY_CONFIDENCE` are stored but not shown as actionable
- [ ] Recommendations require `OPSWATCH_MIN_RECOMMENDATION_CONFIDENCE` (see `assertRecommendationAllowed`)
- [ ] Empty / learning banners appear when evidence is insufficient
- [ ] Portfolio **Risk (evidence)** column only reflects open alerts/incidents/health — never an invented score

## Topology / performance

- [ ] Topology loads without timeout (batching + soft cache intact)
- [ ] Live traffic animation, replay, and filters still work
- [ ] Empty/loading/error states render honestly
- [ ] Application panel shows when no node selected; node drawer when selected
- [ ] Intelligence harvest on `/intelligence` does not reintroduce N+1 check-result queries on topology
- [ ] Hierarchy / CONTAINS remap: edges visible for seeded OpsWatch self-monitor when relationships exist

## Application workspace tabs

- [ ] Tabs present: Overview, Modules, Workflows, Components, Topology, Incidents, Alerts, Automation, Intelligence, Configuration
- [ ] Legacy Services → Components redirect; Metrics/Logs/Deployments reachable from Configuration
- [ ] Project Automation stats come from `/intelligence/automation-history` (no hardcoded success %)
- [ ] Logs (`/log-streams`) shows honest “not connected” empty state
- [ ] Deployments tab shows change events / intelligence records only

## Automation clamps (always)

- [ ] New apps default to **Auto-Heal Safe Actions** (`AUTO_HEAL_SAFE`), not Full Autonomous
- [ ] Missing remediator / disabled auto-run / emergency stop still clamp and surface `blockedReason`
- [ ] Allowlisted safe auto-exec can run only when project mode + remediator + policy allow

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
pnpm --filter @opswatch/web test -- src/components/intelligence/ai-operations-status.test.tsx
pnpm --filter @opswatch/web typecheck
pnpm lint   # must be 0 errors and 0 warnings
```

## Sign-off

- [ ] Profile verify section completed
- [ ] Local runtime evidence attached (feature-gates payload + AI Operations Status)
- [ ] Owner authorized push separately (this checklist alone is not ship approval)

## Push gate

- [ ] All related commits are local only
- [ ] Owner requested a **single** production push
- [ ] Run migrations (including automation-mode default + prior intelligence foundation) against production DB before or with deploy
- [ ] Production env verify section completed (explicit profile choice)
