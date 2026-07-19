# Topology Model Unification Inventory (Phase 4)

Inventory date: 2026-07-19  
Baseline commit: `1b91b0e82f21981ab649a5daaa9ea9c783444022`  
Status: implementation inventory; canonical cutover is blocked until comparison, parity, reference, and integrity gates pass.

OpsWatch currently has two active graph stores:

1. Product topology: `Service` and `ServiceDependency`.
2. Universal operational graph: `OperationalEntity` and
   `OperationalRelationship`.

The product topology UI reads the first graph. OTEL and the generic operational
graph APIs primarily write the second graph. Phase 3 added a partial adapter and
selective dual-write, but neither graph is a complete projection of the other.
That asymmetry is the Phase 4 problem.

## Canonical decision

`OperationalEntity` and `OperationalRelationship` become authoritative.

`Service` and `ServiceDependency` remain additive compatibility tables during
Phase 4. They are not deleted because checks, alerts, events, SLOs, maintenance,
historical automation records, change ledgers, and several operational paths
still reference legacy service IDs.

The product topology continues to expose `ProjectTopologyResponse` while the
storage and identity source under that contract changes to the canonical graph.
Canonical IDs become primary. Legacy IDs remain explicit compatibility
metadata, never inferred by display name after cutover.

## Existing one-time projection

Migration
`apps/api/prisma/migrations/20260715093000_universal_operational_foundation/migration.sql`
created:

- `legacy-project:<projectId>` entities.
- `legacy-service:<serviceId>` entities.
- `legacy-project-service:<serviceId>` containment edges.
- `legacy-dependency:<dependencyId>` relationships.

The migration was a snapshot. There is no trigger, outbox, reconciliation job,
or shared writer that maintains parity after it runs. Projects without an
organisation at migration time were skipped.

## Model and field inventory

### Project / application

Current purpose:

- Application, billing, credentials, monitoring, and product-navigation root.
- Carries `environment`, optional `operationalLocationId`, stored status, and
  project-level signal timestamps.

Writers:

- `apps/api/src/controllers/projects.controller.ts`
- `apps/api/src/routes/truenumeris.routes.ts`
- setup, smoke, and customer seed scripts under `scripts/`

Readers:

- project loaders/controllers, topology loader, alerts, incidents, reports,
  automation, intelligence, and web application pages.

Compatibility requirements:

- Project remains the application scope.
- A canonical APP anchor must exist for every organised project.
- Existing projects with no location remain valid.
- Project rename, environment, organisation, location, and lifecycle changes
  must be reflected through the shared graph writer.

### Service

Schema: `apps/api/prisma/schema.prisma`, `model Service`.

Current purpose:

- Product topology node.
- Monitoring attachment for Check, Alert, Event, SLO, maintenance, ownership,
  change-ledger, and automation paths.
- Encodes the product hierarchy using `ServiceType` values `APP`, `MODULE`,
  `WORKFLOW`, and `COMPONENT`.

Fields:

- Identity: `id`, `projectId`, `name`, `type`.
- Health: `status`.
- Product metadata: `criticality`, `isCritical`, `baseUrl`.
- Ownership: `ownerUserId`, `ownerTeam`, `runbookUrl`,
  `escalationContact`.

Missing canonical capabilities:

- No organisation/environment identity fields.
- No stable external identity or source alias.
- No freshness, first/last seen, confidence, provenance, discovery state,
  metadata, or lifecycle.
- No unique identity constraint inside a project.

Writers:

- `apps/api/src/controllers/services.controller.ts`
- `apps/api/src/services/url-monitoring-provisioning.service.ts`
- `apps/api/src/services/agentless-connection.service.ts`
- `apps/api/src/controllers/product-insights.controller.ts`
- `apps/api/src/routes/truenumeris.routes.ts`
- Noble/StarLiz and setup scripts
- tests creating direct Prisma fixtures

Readers and consumers:

- `topology-loader.service.ts`, `topology.service.ts`
- checks/alerts/events/SLO/maintenance
- incident correlation and causal graph
- remediation and automation planning/execution
- project health and layer health
- reports, ownership, change ledger, connection summaries

Breakage if stopped immediately:

- Existing FKs would fail or become unresolved.
- Alert grouping and incident propagation would lose service adjacency.
- Automation target resolution and historical runs would lose target IDs.
- Check/SLO evidence could not be attached to product nodes.

### ServiceDependency

Schema: `model ServiceDependency`.

Current purpose:

- Product hierarchy and runtime/data/auth/queue/external relationships.
- Relationship evidence for incident correlation, dependency impact,
  intelligence, automation, and the product topology UI.

Fields:

- `id`, `projectId`, `fromServiceId`, `toServiceId`, `dependencyType`.
- `criticality`, `isActive`.
- `evidenceCount`, `evidenceStrength`, `lastObservedAt`, `source`.

Missing canonical capabilities:

- No authoritative health/freshness/discovery state.
- No first seen, stale/inactive timestamps, approval, latency, error rate, or
  safe metadata.
- No explicit compatibility FK to an OperationalRelationship.
- No database constraint proving endpoint-project consistency.

Writers:

- `service-dependencies.controller.ts`
- OTEL API and worker processors
- dependency learning
- Noble/StarLiz seeds and direct test fixtures

Readers:

- product topology
- incident correlation, RCA, incident memory, dependency impact
- remediation suggestions
- topology live-operations feed
- Operations Timeline references by relationship ID

### OperationalLocation

Current purpose:

- Optional organisation-scoped location hierarchy with type, region, topology
  mode, lifecycle, and metadata.

Current limitations:

- A Project has at most one direct location.
- No explicit multi-location membership/deployment model.
- A shared entity may have no location.
- Root location uniqueness is weakened by nullable `parentLocationId`.
- Parent/child organisation agreement is application-enforced.

Phase 4 compatibility:

- No existing entity receives a fabricated location.
- Null means unbound/global only when evidence supports that interpretation.
- Cross-location relationships retain explicit organisation, project,
  environment, and endpoint context.

### OperationalEntity

Schema: `model OperationalEntity`.

Current purpose:

- Universal operational node.
- OTEL logical services, runtime instances, discovered dependencies, manual
  declarations, compatibility entities, and operational health.

Fields already present:

- Scope: `organizationId`, optional `projectId`,
  `operationalLocationId`.
- Identity: `id`, `entityType`, `name`, `externalId`,
  `legacyServiceId`.
- Health: `health`, `healthOverride`, `healthReason`,
  `healthConfidence`, `criticality`.
- Discovery/freshness: `provenance`, `discoverySource`, `discoveredAt`,
  `firstSeenAt`, `lastSeenAt`, `freshUntil`, `staleAt`, `inactiveAt`,
  `signalCount`, `lastSignalKind`, `discoveryState`, `lifecycle`.
- Safe extension: `tagsJson`, `metadataJson`.
- Ownership/routing fields.

Required additions or stronger contracts:

- Explicit stable identity key including organisation, project/application,
  environment, entity type, and logical identity.
- Environment as a queryable field, not metadata only.
- Confirmation and manually-managed state.
- Shared-service and test/seed classification.
- Explicit compatibility mapping rather than treating a globally unique
  `legacyServiceId` as sufficient identity context.
- Alias/source identity records when several sources describe one entity.

Identity risks:

- Nullable `externalId` permits duplicate manual rows.
- Existing OTEL identity is based partly on mutable service name.
- Existing migration copies `Service.type` while OTEL looks for `SERVICE`.
- One source can overwrite another source's provenance/metadata.
- Organisation/project/location agreement is not database-enforced.

### OperationalRelationship

Schema: `model OperationalRelationship`.

Fields already present:

- Scope and endpoints.
- Relationship type and direction by ordered endpoints.
- Provenance, approval, criticality, confidence, impact role.
- Observation count/evidence.
- First discovery/last observation and lifecycle.
- Freshness, health, latency, and error rate.

Required additions or stronger contracts:

- Explicit legacy ServiceDependency compatibility mapping.
- First-seen field distinct from discovery event.
- Environment/context identity.
- Confirmation/manually-managed state.
- Automation capability metadata.
- Source-specific identities/evidence without last-writer-wins provenance.
- Alert/incident linkage counts and typed joins.
- Consistency validation across organisation, project, environment, and
  endpoints.

Relationship direction:

- `HIERARCHY`: child points to parent in the legacy graph.
- `CONTAINS`: parent points to child in the existing project compatibility
  projection.
- Runtime dependencies: source caller/dependent points to target callee.

The canonical normaliser must preserve these semantics explicitly.

## Related models and legacy references

### Alert

- Primary topology reference: `serviceId`.
- OTEL evidence already has `entityId` and `relationshipId`.
- Fingerprinting, filtering, maintenance suppression, notifications, and
  topology risk use `serviceId`.
- Phase 4 adds canonical reference fields while retaining `serviceId`.

### Incident

- No canonical affected-entity or affected-relationship joins.
- Affected topology is inferred through IncidentAlert → Alert.serviceId.
- OTEL incident evidence carries canonical IDs, but RCA/propagation currently
  ignores them.
- Phase 4 needs typed affected/root-cause canonical references.

### Check / CheckResult

- Check belongs to Service.
- Connection ownership is partly stored in `Check.configJson.connectionId`.
- Programme debt requires indexed `Check.connectionId`.
- Check evidence must update canonical entity health without refreshing
  unrelated relationship freshness.

### Heartbeat

- Scoped to Project/environment.
- `ingestHeartbeat()` updates Project health and records observations.
- It does not update a canonical APP entity.
- Heartbeat must resolve the environment-specific APP anchor through the
  shared graph writer.

### Automation and remediation

Legacy references:

- `RemediationLog.serviceId`
- `AutomationRunStep.targetServiceId`
- `AutomationRun.affectedServiceIds`
- plan/result JSON
- deployment and incident-memory JSON service arrays

Canonical requirement:

- New runs persist canonical entity/relationship IDs.
- Historical legacy IDs resolve through compatibility mappings.
- Relationship selection, automation evaluation, approval state, execution,
  and recovery verification stay intact.

### Operations Timeline and change records

- Timeline uses generic `sourceType/sourceId`.
- Dependency events currently use `SERVICE_DEPENDENCY` and legacy edge IDs.
- ChangeEvent, ChangeLedgerEntry, and DeploymentRecord retain service IDs.
- New events use canonical source identities; historical IDs remain
  translatable.

## Writer inventory

### Application registration

`projects.controller.ts` creates/patches/deletes Project and optional URL
monitoring. It does not maintain an APP canonical entity.

### URL onboarding

`url-monitoring-provisioning.service.ts` creates Connection, Service, and
HTTP/SSL Checks. It writes no OperationalEntity.

Required canonical behavior:

- Upsert a WEBSITE or ADMIN_PORTAL entity from normalised URL origin.
- Map the compatibility Service in the same transaction.
- Add indexed Check.connectionId.
- Repeated provisioning resolves the same logical entity.

### Heartbeat

`heartbeats.service.ts` writes Heartbeat and Project health only.

Required canonical behavior:

- Resolve one APP entity per organisation/project/environment.
- Update entity evidence/freshness only.
- Never refresh dependency relationship evidence.

### OTEL API processor

`apps/api/src/services/otel/otel-process.service.ts` uses the richer identity,
dependency, policy, freshness, and evidence services.

### OTEL worker processor

`apps/worker/src/services/otel/otel-batch-processor.service.ts` independently
implements identity, relationship, alerts, health, retries, and dual-write.

Differences:

- Worker does not perform the API service-name compatibility lookup.
- Worker simplifies target identity to EXTERNAL_API/CALLS.
- API distinguishes databases, queues, and relationship types.
- Metadata, stale clearing, health defaults, alert behavior, and retry
  semantics differ.

Phase 4 rule:

- One shared OTEL processor owns both paths.
- The worker imports or invokes that processor; it must not retain a second
  graph implementation.

### Generic API discovery

`agentless-connection.service.ts` currently fetches configured JSON and audits
top-level keys. It does not create graph discovery.

Phase 4 rule:

- Any future discovered entity/relationship is written through the shared
  graph writer with `DISCOVERED_API` provenance.
- Existing shallow inspection must not claim discovery capability.

### Manual declarations

- Legacy CRUD: services and service-dependencies controllers.
- Operational CRUD: operational-graph controller.

Both currently write only their own graph. Phase 4 routes both through the
canonical writer; necessary legacy mirrors are compatibility output.

### Seeds/imports

- `scripts/lib/noble-express-graph.seed.ts`
- `scripts/lib/starliz-academy-graph.seed.ts`
- API Prisma seed and setup scripts

They create only Service/ServiceDependency today. Canonical seeds must be
idempotent and use `SEEDED_TEST`, never live-discovery provenance.

### Provider synchronisation and automation outcomes

Current provider setup and automation recovery generally update Project,
Service, Connection, or JSON state. Canonical topology changes must use the
shared writer with factual provenance and cannot invent relationships.

## Reader and UI inventory

### Product topology

Route:

- `GET /projects/:projectId/topology`

Current loader:

- `apps/api/src/services/topology-loader.service.ts`
- reads Service and ServiceDependency first
- calls `buildProjectTopologyResponse()`
- overlays OTEL entities only when `legacyServiceId` resolves
- overlays OTEL relationships only when a matching legacy edge already exists

Operational-only nodes and edges are invisible.

### Operational graph API

`operational-graph.controller.ts` supports list/create/propose/observe/review
and health recalculation. The web application has no direct consumer.

### Frontend

Main files:

- `apps/web/src/app/projects/[projectId]/topology/page.tsx`
- `apps/web/src/components/topology/topology-types.ts`
- canvas, layout, edge resolver/style, node/relationship drawers, filter bar,
  key, application panel, and live-ops feed under
  `apps/web/src/components/topology/`

Compatibility requirements:

- Keep `ProjectTopologyResponse`.
- Preserve grey dashed hierarchy.
- Preserve evidence-driven green/amber/red/grey dependency colors.
- Preserve clickable lines, drawers, Fit, zoom/pan, collapsed cards,
  timeout recovery, and mobile behavior.
- Replace name-based layer/discovery heuristics when canonical fields exist.
- Historical replay remains Phase 5 and is not implemented here.

## Health and freshness ownership

Current independent calculations:

- Service status persisted by check jobs and OTEL.
- Project status persisted by heartbeat/check roll-up.
- `topology.service.ts` derives node/edge health from checks, alerts,
  incidents, SLOs, and heartbeat.
- operational health services persist Operational* health.
- OTEL freshness jobs mutate Operational*.
- frontend edge helpers can infer display state.

Canonical precedence after cutover:

1. Explicit allowed manual override.
2. Active critical/down evidence.
3. Active degraded/at-risk evidence.
4. Fresh healthy evidence.
5. No fresh evidence → UNKNOWN.
6. Maintenance/disabled remain explicit non-healthy states and map honestly to
   product presentation.

Rules:

- Relationship freshness is updated only by relationship evidence.
- Project heartbeat never refreshes a relationship.
- Stale/inactive evidence maps to Unknown, never Healthy.
- Service/ServiceDependency health may remain rollback metadata but does not
  drive product topology after cutover.

## Identity and deduplication rules

Canonical entity identity includes:

- organisation
- project/application context where isolated
- environment
- entity type
- stable logical key

Source-specific stable keys:

- declared: explicit stable key or compatibility ID
- URL: normalised URL origin plus role
- heartbeat: project APP anchor plus environment
- OTEL logical service: service namespace/name plus environment
- OTEL runtime instance: logical parent plus host/container/serverless ID
- provider: provider plus external resource ID
- database/queue: provider/system identity, never display name alone
- shared service: organisation/environment identity with explicit shared scope

Never merge:

- across organisations
- across environments
- logical service with runtime instance
- application module with infrastructure resource

Ambiguous compatibility mappings fail closed and appear in comparison/audit
output.

## Cutover gates

The product topology loader must not switch until:

1. Service/ServiceDependency backfill is idempotent.
2. Explicit legacy/canonical mapping is complete or ambiguity is reported.
3. OTEL migrated-service collision tests pass.
4. API/worker OTEL parity passes.
5. Integrity audit has no unexplained critical errors.
6. Alert and incident canonical reference migration passes.
7. Automation resolves a selected canonical relationship.
8. Noble Express comparison loses no entities or relationships.

Required comparison report:

- legacy/canonical entity counts
- legacy/canonical relationship counts
- missing records
- duplicates
- ambiguous mappings
- health differences
- alert/incident reference differences

## Rollback

- Additive migration only.
- Keep legacy tables and fields.
- Canonical-read feature flag can revert readers to Service*.
- Dual-write keeps rollback rows current during the Phase 4 window.
- No rollback deletes canonical data.
- Clear topology cache after a read-mode switch.
- Prefer additive forward fix over database restore.

## Integrity audit requirements

Report safely:

- duplicate canonical identities
- orphan entities
- missing parents/endpoints
- cross-organisation/project/environment relationships
- conflicting/stale health
- legacy-only entities/relationships
- canonical records not visible to product topology
- ambiguous mappings
- seed/test entities shown as live discovery
- unresolved historical alert/incident/automation references

No secret-bearing metadata is exposed in diagnostics.

## Retirement tracking (not executed in Phase 4)

Track:

- Service as topology authority
- ServiceDependency as topology authority
- duplicate OTEL processor
- product OTEL overlay adapter
- duplicate loaders and frontend graph heuristics
- legacy IDs in new alerts/incidents/automation
- legacy-only seeds and CRUD paths
- raw service-dependency live-ops feed

Destructive retirement requires separate approval after a verified rollback
window.

## Phase 4 non-goals

- Do not drop legacy graph tables.
- Do not push, deploy, or modify production.
- Do not implement historical replay.
- Do not start searchable logs/APM.
- Do not add native Datadog/Dynatrace connectors.
- Do not fabricate locations or relationships.
