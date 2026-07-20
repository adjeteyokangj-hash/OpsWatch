# Phase 9 — Learning and prediction inventory

Date: 2026-07-20  
Baseline: `6265debcc995474e5aa4923cb526499fe906dd27` on `main`  
Programme source: `docs/opswatch-observability-programme.md` (Phase 9)

OpsWatch is an agentless application-health and incident-remediation platform
with an advanced topology foundation. This inventory locks what already exists
for **learning scaffolding, gated prediction storage, diagnosis/RCA, and
feedback-adjacent outcomes** before Phase 9 activation. Placeholders, schemas
without writers, read-path harvest, UI banners, and env flags that are ignored
do **not** count as completed Phase 9 capability.

**Hard stop:** Predictions are **hard-disabled in code**.
`isPredictionsEnabled()` always returns `false`
(`apps/api/src/services/intelligence/intelligence-constants.ts`). The
`PREDICTIONS` feature gate also hardcodes `enabled: false` regardless of
`OPSWATCH_PREDICTIONS_ENABLED`
(`apps/api/src/services/intelligence/feature-gates.service.ts`). There is
**no** prediction worker/job. `PredictionCandidate` and
`ApplicationLearningModel` have **no Prisma product writers**. Phase 9 must not
invent live predictions from seeded/fixture/insufficient data, claim guaranteed
failures or attacks, begin native Datadog/Dynatrace connectors, or treat
baselines/patterns/diagnosis as predictions.

Related prior inventories: `docs/phase5-product-truth-inventory.md`,
`docs/phase7-remediation-inventory.md`, `docs/phase8-security-threat-inventory.md`.

---

## Existing stop points (summary)

| Exists today | Phase 9 must build / prove |
| --- | --- |
| Schema + gated framework (`PredictionCandidate`, accuracy log, learning models) | Real writers + scheduled harvest; product emission only behind verified gates |
| Read-path harvest of `LearningBaseline` / `OperationalPattern` on `GET /intelligence` | Dedicated baseline jobs with defined sample windows and cadence |
| Incident memory on resolve + similarity search | Explainable matching + feedback into prediction accuracy / FP review |
| Rule + optional OpenAI diagnosis / RCA overlays | Honest separation: diagnosis ≠ prediction; explanations labelled |
| APM “above baseline” latency/error heuristics | Deterministic anomaly product with min evidence (not prediction) |
| Remediation `predictedLabel`/`predictedScore` + `/accuracy` UI | Wire outcomes into learning models (not only action accuracy reports) |
| Deployment / change ledger correlation | Sequence learning from deploy → alert/incident windows |
| Phase 8 `SecurityBaselineSample` model | Persist security baselines (model exists; **no writers found**) |
| Feature gates list + Intelligence UI “Feature disabled” | Separate stage flags; UI explains which stages are enabled |
| Topology `predictedNextOccurrenceAt` from mean interval | Gate, relabel, or remove ungated extrapolation |

---

## Missing / empty writers (confirmed)

| Model / path | Schema | Product writer? |
| --- | --- | --- |
| `PredictionCandidate` | Yes | **No** — no product `prisma.predictionCandidate.*` usage |
| `PredictionAccuracyLog` | Yes | Helper only (`recordPredictionOutcome`); **no production caller** |
| `ApplicationLearningModel` | Yes | **No** |
| `SecurityBaselineSample` | Yes (Phase 8) | **No** create/upsert found |
| `upsertOperationalPattern` / `upsertLearningBaseline` | Services exist | Live harvest bypasses them (inline Prisma in brain-snapshot) |
| `recordDependencyEvidence` | Service exists | **No callers** |
| `runLearningPredictionCycle` | Service exists | **Tests only** |
| Prediction worker job | N/A | **Absent** from `apps/worker/src/jobs/` |

---

## Path inventory

For every path: **real data source · persistence · execution cadence · minimum
evidence · confidence · UI · review workflow · feedback path · current stop
point**.

### 1. Learning database models (schema spine)

| Aspect | State |
| --- | --- |
| Real data source | Migration `20260714170000_intelligence_foundation`; models in `apps/api/prisma/schema.prisma` |
| Persistence | `LearningBaseline`, `OperationalPattern`, `OperationalObservation`, `AiConfidenceRecord`, `PredictionCandidate`, `PredictionAccuracyLog`, `ApplicationLearningModel`, `AiDecisionAudit`, `DeploymentRecord`, `OperationsTimelineEvent`, `IncidentMemoryEntry` |
| Execution cadence | Schema only |
| Minimum evidence / confidence | Documented on models (e.g. pattern `displayEligible`) |
| UI | Consumed where writers exist |
| Review workflow | None at schema layer |
| Feedback path | None |
| Current stop point | Tables ≠ capability. Several models remain empty storage |

### 2. `LearningBaseline` + harvest samples

| Aspect | State |
| --- | --- |
| Real data source | Best-effort harvest from `CheckResult` PASS/FAIL aggregates (14-day) in `harvestEvidenceFromOperationalData` — `brain-snapshot.service.ts` |
| Persistence | `LearningBaseline` scopes: `RESPONSE_TIME`/`org_checks`, `TRAFFIC`/`org_check_volume` |
| Execution cadence | **On Intelligence API read** when `harvest !== false`. Not a worker. Many callers use `?harvest=false` |
| Minimum evidence | `MIN_BASELINE_SAMPLES` default **5** (`OPSWATCH_MIN_BASELINE_SAMPLES`) |
| Confidence | Sample-count “ready” flag only; not predictive |
| UI | `/intelligence` baselines list; project insights; dashboard teaser |
| Review workflow | None |
| Feedback path | None |
| Current stop point | Opportunistic read-path upsert; no scheduled sampling; not rolling windows with percentiles/variance |

### 3. `OperationalPattern` (calculated patterns)

| Aspect | State |
| --- | --- |
| Real data source | Harvest: alert `groupBy` title+project (≥2 / 14d) → `REPEATED_FAILURE` |
| Persistence | `OperationalPattern` (`displayEligible`, `confidenceScore`, `evidenceJson`) |
| Execution cadence | On Intelligence read harvest |
| Minimum evidence | Evidence count ≥3 for display eligibility (`confidence.service.ts`) |
| Confidence | `computeConfidence`; display bar `MIN_DISPLAY_CONFIDENCE` default **0.7** |
| UI | Intelligence page splits displayable vs learning patterns |
| Review workflow | Suppress path exists only via unused `pattern.service.ts` |
| Feedback path | None |
| Current stop point | Only repeated-alert patterns harvested; other `PATTERN_TYPE` values unused |

### 4. `PredictionCandidate` + `PredictionAccuracyLog`

| Aspect | State |
| --- | --- |
| Real data source | Scaffold: `prediction-gate.service.ts`, `learning-prediction.service.ts` |
| Persistence | Tables exist; **no product inserts**. Snapshot hardcodes `candidatesStored: 0` |
| Execution cadence | None in production |
| Minimum evidence | Gate wants score ≥ `MIN_PREDICTION_CONFIDENCE` (0.85) **and** predictions enabled — enablement hardcoded off |
| Confidence | Draft only |
| UI | `data-testid="predictions-disabled-state"` on `/intelligence` |
| Review workflow | `recordFalsePositive` helper — **no API/UI** |
| Feedback path | Scaffold only |
| Current stop point | Framework only. Env `OPSWATCH_PREDICTIONS_ENABLED` is **intentionally ignored** |

### 5. Intelligence UI pages / routes

| Aspect | State |
| --- | --- |
| Real data source | `intelligence.routes.ts` → `brain-snapshot.service.ts` |
| Persistence | Reads models; harvest may write baselines/patterns/deployments |
| Execution cadence | User-driven page load |
| Minimum evidence | Banner EMPTY / LEARNING / ACTIVE from counters |
| Confidence | Gates shown; prediction emission false |
| UI | `apps/web/src/app/intelligence/page.tsx` |
| Review workflow | `GET /intelligence/audit` read-only |
| Feedback path | None for predictions |
| Current stop point | Honest Feature disabled copy; not Phase 9 complete |

### 6. Incident memory (`IncidentMemoryEntry`)

| Aspect | State |
| --- | --- |
| Real data source | On incident `RESOLVED` — `indexIncidentMemory` after diagnosis |
| Persistence | `IncidentMemoryEntry` (signature, optional embedding, recovery fields) |
| Execution cadence | Event-driven on resolve |
| Minimum evidence | Similarity ≥0.2 Jaccard/embedding mix |
| Confidence | Similarity score — not prediction confidence |
| UI | Intelligence incident-memory section; topology relationship drawer |
| Review workflow | None |
| Feedback path | Similar incidents feed diagnosis; not prediction accuracy |
| Current stop point | Real memory for diagnosis. Topology `predictedNextOccurrenceAt` is ungated mean-interval extrapolation |

### 7. RCA and diagnosis services

| Aspect | State |
| --- | --- |
| Real data source | `incident-ai.service.ts`, `incident-analysis.service.ts`, causal graph |
| Persistence | Mostly computed; optional `Incident.rootCause` |
| Execution cadence | On demand |
| Minimum evidence | Alerts, timeline, checks, SLOs |
| Confidence | Rule 0–1; optional LLM adjust |
| UI | Incident pages, remediation suggest, causal graph |
| Review workflow | Human root-cause notes; no formal RCA approval |
| Feedback path | Memory similarity; remediation outcomes separate |
| Current stop point | Diagnosis ≠ prediction. `ADVANCED_RCA` flag has no product emitter |

### 8. OpenAI-assisted explanation

| Aspect | State |
| --- | --- |
| Real data source | Chat completions / embeddings when `INCIDENT_AI_LLM_ENABLED` + key |
| Persistence | Diagnosis response; optional embeddings on memory |
| Execution cadence | On diagnosis / memory index |
| Minimum evidence | Rule draft + context; soft-fail to rule-only |
| Confidence | LLM 0–1 validated via shared schemas |
| UI | Diagnosis text / `analysisMode: "LLM"` |
| Review workflow | None |
| Feedback path | None into accuracy log |
| Current stop point | Explanation only — must not invent unsupported facts in Phase 9 |

### 9. Anomaly helpers (non-prediction)

| Aspect | State |
| --- | --- |
| Real data source | APM prior-window heuristics; Phase 8 security `baselineNoteFor`; event spikes |
| Persistence | APM windows / security findings — not unified anomaly store |
| Execution cadence | OTEL/APM processing; security detection |
| Minimum evidence | APM sample floors; security rule `minimumSamples` |
| Confidence | Deterministic health / finding confidence |
| UI | Logs/APM; Security workspace |
| Review workflow | Security FP lifecycle only |
| Feedback path | Not linked to prediction accuracy |
| Current stop point | Ingredients for Phase 9; no unified anomaly → prediction pipeline |

### 10. Feature flags

| Gate / env | Default today | Effect |
| --- | --- | --- |
| `PREDICTIONS` / `OPSWATCH_PREDICTIONS_ENABLED` | **Always off** | Product emission blocked; env ignored |
| `LEARNED_TOPOLOGY` | off | Observation-driven relationship create |
| `OTEL_INGESTION` | off | OTEL bridge |
| `AUTO_REPAIR` | off | High-impact repair permission |
| `ADVANCED_RCA` | off | Flag only |
| `OPSWATCH_MIN_*_CONFIDENCE` / `MIN_BASELINE_SAMPLES` | constants | Thresholds |
| `INCIDENT_AI_LLM_ENABLED` | off unless true | LLM/embeddings |

Phase 9 must add **separate** stage flags: baseline calculation, anomaly
detection, incident matching, prediction candidate generation, prediction
notifications, preventive automation recommendations.

### 11. Prediction workers / jobs

| Aspect | State |
| --- | --- |
| Real data source | **None** |
| Persistence | N/A |
| Execution cadence | N/A |
| Minimum evidence / confidence | N/A |
| UI / review / feedback | N/A |
| Current stop point | Intelligence page harvest is not a prediction worker |

### 12. Remediation outcome data

| Aspect | State |
| --- | --- |
| Real data source | `RemediationLog.predictedLabel`/`predictedScore`; `AutomationRun` / `AutomationOutcome` |
| Persistence | As above |
| Execution cadence | Per remediation / automation run |
| Minimum evidence | Action confidence scoring |
| Confidence | Action-level — not `AiConfidenceRecord` |
| UI | `/accuracy`, reports; insights may invent time-saved heuristic |
| Review workflow | Analytical accuracy report only |
| Feedback path | Does **not** write `PredictionAccuracyLog` |
| Current stop point | Strong input for Phase 9; learning loop not closed |

### 13. Deployment / change history

| Aspect | State |
| --- | --- |
| Real data source | `ChangeEvent` / `ChangeLedgerEntry`; harvest `syncDeploymentsFromChangeEvents` |
| Persistence | `DeploymentRecord` with post-deploy alert/incident IDs |
| Execution cadence | On Intelligence harvest |
| Minimum evidence | Deploy-like events; temporal co-occurrence |
| Confidence | No causality score |
| UI | Intelligence deployments; project deployments |
| Review / feedback | None |
| Current stop point | Real facts — not predictive deploy risk |

### 14. Security baselines (`SecurityBaselineSample`)

| Aspect | State |
| --- | --- |
| Real data source | Schema only; Phase 8 computes in-memory wording |
| Persistence | **No writers** |
| Execution cadence | N/A |
| Minimum evidence / confidence | Unused model fields |
| UI | Finding baseline notes only |
| Review / feedback | Security FP lifecycle |
| Current stop point | Do not count as learning baseline capability |

### 15. Seeded / static insights

| Item | Honesty |
| --- | --- |
| Product Insights recommendations | Deterministic coverage heuristics — not ML |
| Insights `averageTimeSavedMinutes` | Invented (`succeededCount * 8`) |
| Topology learning progression | Client heuristic — not `ApplicationLearningModel` |
| Fixtures / eval cases | Test-only |

### 16. `AiConfidenceRecord` + `AiDecisionAudit`

| Aspect | State |
| --- | --- |
| Real data source | Pattern upsert orphan; automation executor writes some audits |
| Persistence | Both models |
| Execution cadence | Pattern path unused; automation on run completion |
| Confidence | `confidence.service.ts` math |
| UI | Intelligence counters + audit list |
| Review / feedback | Read-only |
| Current stop point | Confidence records largely unpopulated on live harvest |

### 17. Prediction-related statuses

`PREDICTION_STATUS`: `DISABLED`, `INSUFFICIENT_DATA`, `READY`  
`CONFIDENCE_LABEL`: `HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT`  
`PATTERN_TYPE`: several constants; only `REPEATED_FAILURE` harvested  
Learning snapshot: `EMPTY` | `LEARNING` | `ACTIVE`

---

## Gaps Phase 9 must close

1. Data-quality filters: exclude seeded/fixture/demo/stale/insufficient samples; retain quality state.
2. Real baselines for availability, latency, throughput, errors, deps, security volumes, deploy/remediation rates — with sample stats and confidence.
3. Explainable deterministic anomalies (threshold, deviation, trend, spike, absence).
4. Incident-pattern memory with fingerprints, propagation, remediation outcomes; exclude low-confidence root causes from confirmed memory.
5. Similar-incident matching with evidence differences (no automatic same-cause claim).
6. Deterioration detection from sustained multi-window evidence.
7. Prediction candidates with evidence, horizon, expiry, review states — generation **default off**.
8. Confidence levels Low/Moderate/High from documented factors.
9. Human review confirm/dismiss/outcome feedback.
10. Preventive recommendations via Phase 7 registry (low-risk only).
11. Remediation-outcome learning (no single-success promotion).
12. Security learning as elevated-risk patterns — no breach certainty.
13. Honest Intelligence UI sections; no seeded prediction cards.
14. Versioning, retention, org isolation, acceptance tests + browser evidence.

---

## Explicit non-goals (this inventory)

- Implementing Phase 9 product code in the inventory commit  
- Claiming Intelligence page = learning/prediction complete  
- Enabling predictions in production without gates + evidence  
- Guaranteed failure/attack prediction  
- Native Datadog / Dynatrace connectors  
- Training cross-organisation foundation models  

---

## Suggested follow-on commits

1. Baseline and anomaly schema  
2. Baseline calculation and anomaly detection  
3. Incident memory and similarity  
4. Prediction candidates and confidence  
5. Remediation outcome learning  
6. Intelligence UI  
7. Privacy/retention/versioning  
8. Tests and verification fixes
