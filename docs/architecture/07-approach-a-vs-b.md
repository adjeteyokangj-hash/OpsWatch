# 07 — Approach A (Agentless) vs Approach B (Collector / OTEL)

**Phase:** 1 assessment  
**Product rule:** Both approaches are first-class. Customers may use A only, B only, or Hybrid (recommended for multi-site).

---

## 1. Definitions

| Approach | Meaning |
|----------|---------|
| **A — Agentless** | OpsWatch reaches out: HTTP/SSL/keyword/latency/domain checks; stale detection on expected heartbeats if configured; no in-app collector required for basic monitoring. |
| **B — Collector / OTEL** | Customer runtime pushes telemetry: signed SDK heartbeats/events today; future OpenTelemetry traces/metrics/logs via a collector or SDK exporter. |

---

## 2. Explicit mapping — what exists today

| Capability | Approach | Status | Primary code |
|------------|----------|--------|--------------|
| HTTP uptime / status checks | A | **Mature** | `health-checks/http-check.service.ts`, `run-http-checks.job.ts` |
| SSL / cert checks | A | **Mature** | `ssl-check.service.ts`, `run-ssl-checks.job.ts` |
| Keyword / response-time / domain expiry | A | **Present** | `health-checks/*` |
| HEARTBEAT_STALE as check type | A↔B bridge | **Present** | Check type + `processHeartbeatStaleJob` |
| Signed heartbeat push | B (SDK) | **Present** | `@opswatch/client`, `POST /heartbeat` |
| Signed event push | B (SDK) | **Present** | `POST /event` |
| Health snapshot | B (SDK) | **Present** | `POST /health-snapshot` |
| Ingest HMAC + replay nonce | B security | **Present** | `request-signature`, `IngestReplayNonce` |
| Org API keys / project keys | B auth | **Present** | `OrgApiKey`, Project secrets |
| OTEL receiver | B (collector) | **Absent** | Planned Phase 5 |
| Prometheus scrape | A-adjacent | **Absent** | Optional future; SLO math is internal today |
| Log shipping agent | B | **Absent** | Future / Integration |

---

## 3. How signals converge (shared spine)

Both approaches write into the **same operational spine**:

```
CheckResult / Heartbeat / Event / (future OTEL-derived Observation)
        ↓
   Alerting + Project/Service health
        ↓
   Incident + Timeline + Correlation
        ↓
   Topology / Causal graph / ChangeEvent
        ↓
   Intelligence observations (facts) → gated predictions
        ↓
   Automation plans (OBSERVE by default)
```

**Design implication:** Phases 2–10 must not fork “agentless incidents” vs “OTEL incidents”. Enrichment differs; models stay shared. Location (Phase 3) tags the spine, not the approach.

---

## 4. Hybrid mode (recommended)

| Site mode | Typical mix |
|-----------|-------------|
| **Centralised SaaS** | A for public URLs + B heartbeats from API/workers |
| **Distributed branches** | A for edge health endpoints where reachable; B collectors where NAT/firewall blocks inbound |
| **Hybrid org** | HQ Systems: A+B; Branch Locations: B-heavy + selective A |

Universal Connection Framework (Phase 2) should present Connection types:

1. `AGENTLESS_CHECK` (Approach A)
2. `OPSWATCH_SDK` (Approach B lite — today)
3. `OTEL` (Approach B full — Phase 5)
4. `PROVIDER_INTEGRATION` (GitHub/Vercel/Render/webhook — side channel)

---

## 5. When to prefer which

| Prefer A when | Prefer B when |
|---------------|---------------|
| Public HTTPS endpoints exist | Private networks / no inbound from OpsWatch |
| SSL/domain expiry matters | Need process liveness, queue depth, business events |
| Fast onboard with zero code | Deep RCA needs traces / request correlation |
| Compliance bars outbound agents | Customer already runs OTEL collectors |

Never require B for “Connected” marketing if A alone meets the customer’s SLOs — Connection status should reflect configured Approaches honestly.

---

## 6. Phase mapping

| Phase | A work | B work |
|-------|--------|--------|
| 2 UCF | Represent checks as Connection | Represent SDK ingest as Connection |
| 3 Locations | Attach checks to Location/System | Attach ingest credentials to Location/System |
| 4 Graph | Dependency evidence from check failures | Evidence from events/co-occurrence |
| 5 OTEL | — | Collector receiver + correlation |
| 6–8 | RCA/SLO/automation consume both | Same |
| 9 Flags | — | Flag `otel.ingest.enabled` |

---

## 7. Verification sketch

```bash
# Approach A regression
pnpm quarantine:verify-monitoring

# Approach B (SDK) — see docs/real-app-connection.md / connect e2e
pnpm --filter @opswatch/web exec playwright test e2e/connect-journey.spec.ts
```

OTEL verification appears in Phase 5 checklist only.
