# 08 — Branch-Aware Location Entity Design

**Phase:** 1 design (documentation only — **no schema migration in Phase 1**)  
**Target hierarchy:**

```
Organisation
  └── Region? (optional grouping — e.g. “North”, “EMEA”)
        └── Location / Branch / Site
              └── System (today’s Project / Application)
                    └── Module
                          └── Workflow
                                └── Component
```

---

## 1. Entity types (proposed)

### 1.1 `Organization.topologyMode`

| Value | Meaning |
|-------|---------|
| `CENTRALISED` | Systems are org-global; Locations optional metadata; primary health is org/system |
| `DISTRIBUTED` | Systems generally live under Locations; org health is roll-up of site health |
| `HYBRID` | Mix: some Systems unbound (central platforms) + many Location-bound Systems |

Default for existing tenants: treat as `CENTRALISED` until explicitly set (zero behaviour change).

### 1.2 `Region` (optional)

| Field | Notes |
|-------|-------|
| `id`, `organizationId` | Required |
| `name`, `slug` | Unique per org |
| `sortOrder` | UI |
| `isActive` | Soft disable |

Region does **not** own health sensors directly; it aggregates child Location health.

### 1.3 `Location`

| Field | Notes |
|-------|-------|
| `id`, `organizationId` | Required |
| `regionId` | Nullable |
| `name`, `slug` | Unique per org |
| `type` | Enum — see §1.4 |
| `timezone` | Display / maintenance windows |
| `addressJson` / `geoJson` | Optional; not required for health |
| `externalRef` | Customer branch code |
| `isActive` | Soft disable |
| `inheritOrgMode` / `localMode` | Optional override for HYBRID edge cases |

### 1.4 `LocationType` (proposed enum)

Industry-neutral set:

- `BRANCH`
- `SITE`
- `OFFICE`
- `WAREHOUSE`
- `STORE`
- `PLANT`
- `DATA_CENTER`
- `VEHICLE_FLEET` (logical site)
- `OTHER`

Noble “depot / franchise branch” maps to `BRANCH` or `SITE` via configuration — **not** a Noble-specific enum.

### 1.5 System (= today’s `Project`)

Additive only:

| Field | Notes |
|-------|-------|
| `locationId` | Nullable FK → Location |
| Keep existing columns | `defaultRegion` string deprecated later after dual-read |

Rules:

- `locationId = null` → System is **org-central** (valid in CENTRALISED and HYBRID).
- `locationId` set → System contributes to that Location’s health.
- Multi-home Systems (same codebase, many locations) → prefer **one System record per Location** *or* a future `SystemLocationBinding` table; Phase 3 should start with single FK to avoid complexity, document multi-home as Phase 10 option.

### 1.6 Module / Workflow / Component

Remain `Service` rows under System with existing `ServiceType`. No Location FK required if parent System is location-scoped (inherits). Optional later: override for shared central modules serving many sites.

---

## 2. Deployment modes — behaviour matrix

| Concern | Centralised | Distributed | Hybrid |
|---------|-------------|-------------|--------|
| Primary nav | Applications/Systems | Locations → Systems | Both (toggle) |
| Default new System | Unbound | Require Location | Operator chooses |
| Org health | Aggregate System statuses | Aggregate Location statuses (then optional System detail) | Weighted: central Systems + Location roll-ups |
| Incidents list default | Org-wide | Filter by Location | Filter chips |
| Automation blast radius | System/org policy | Default Location-scoped | Strictest applicable scope |
| Ingest keys | Project-scoped | Prefer Location-aware naming; still project secrets v1 | Both |
| SLOs (Phase 7) | System/org | Location + System | Both visible |

---

## 3. Health roll-up rules

Reuse status buckets from today’s layer roll-up:

- **Healthy:** `HEALTHY`
- **Warning:** `DEGRADED`, `RECOVERING`, `MAINTENANCE`, `PAUSED`
- **Critical:** `DOWN`
- **Unknown:** `UNKNOWN` / missing

### 3.1 Component → Workflow → Module → System

Unchanged algorithm intent:

1. Component statuses from Services + checks + signals.
2. Workflow status = worst child Component (critical > warning > unknown > healthy), configurable later.
3. Module status = worst child Workflow/Component set.
4. System (`Project.status`) remains computed by `project-health.service` (extend, don’t replace).

### 3.2 Location (site) health

For Location `L`:

1. Collect all active Systems with `locationId = L`.
2. Location status = **worst** System status (same precedence: DOWN > DEGRADED/… > UNKNOWN > HEALTHY).
3. Optional: if **no** Systems, Location = `UNKNOWN` (not HEALTHY) — empty site is not green.
4. Checks/heartbeats attached only via Systems; Location has no independent Check rows in v1.

**Empty Location ≠ healthy.** This prevents “ghost green” portfolios.

### 3.3 Region health

Worst child Location status (same precedence). Regions with zero Locations → `UNKNOWN`.

### 3.4 Organisation health

Depends on `topologyMode`:

| Mode | Org roll-up inputs |
|------|--------------------|
| `CENTRALISED` | All active Systems (today’s project list) — **preserve current layer-health APPLICATION semantics** |
| `DISTRIBUTED` | All active Locations (site statuses). Unbound Systems optional sidebar / warning banner (“unassigned systems”) |
| `HYBRID` | Union of (a) unbound System statuses and (b) Location statuses; org critical if **any** input critical |

Layer health table (`APPLICATION` / `MODULE` / `WORKFLOW` / `COMPONENT`) should gain optional **scope** query:

- `scope=organization` (default; backward compatible)
- `scope=location&locationId=`
- `scope=region&regionId=`

Phase 3 must keep default `scope=organization` behaviour identical for tenants without Locations.

### 3.5 Incident / alert roll-up

| View | Rule |
|------|------|
| Site | Alerts/Incidents whose System.locationId = L |
| Org | All org entities; optional facet counts by Location |
| Correlation | Prefer same-Location correlation first; cross-Location only with shared dependency evidence |

---

## 4. API / UI sketch (Phase 3+, not Phase 1)

**API (additive):**

- `GET/POST /org/locations`
- `GET/POST /org/regions`
- `PATCH /projects/:id` with `locationId`
- `GET /analytics/layer-health?scope=…`

**UI:**

- Org settings: topology mode
- Locations directory
- System assign Location
- Dashboard filter: All sites / one site
- Preserve Applications portfolio; add Location chip

---

## 5. Migration safety

1. Add tables + nullable `Project.locationId`.
2. Backfill nothing required — all existing rows unbound → CENTRALISED-compatible.
3. Deprecate `Project.defaultRegion` only after UI writes Region/Location consistently.
4. No rename of `Project` table in early phases.

---

## 6. Example (Noble as illustration only)

| Concept | Mapping |
|---------|---------|
| Noble company | `Organization` |
| “North region” | `Region` |
| Depot Birmingham | `Location` type `BRANCH` |
| Booking API at depot | `Project`/`System` with `locationId` |
| Payments module | `Service` MODULE |
| Create booking workflow | `Service` WORKFLOW |
| Postgres / worker | `Service` COMPONENT |

Same pattern works for retail stores, clinics, or factories without schema forks.

---

## 7. Phase 1 confirmation for this design

- Spec only under `docs/architecture/`.
- **No** Prisma models created in Phase 1.
- Implementation starts Phase 3 per [05-migration-plan.md](./05-migration-plan.md).
