import { randomUUID } from "crypto";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  IMPACT_ROLE_VALUES,
  isLearnedTopologyEnabled,
  normalizeImpactRole
} from "../services/operational-health-rollup.service";
import {
  getOperationalGraphHealth,
  observeOperationalRelationship,
  recalculateAndPersistOperationalGraphHealth
} from "../services/operational-health-persist.service";
import { canonicalGraph } from "../services/canonical-graph.service";

const HEALTH_VALUES = new Set(["HEALTHY", "DEGRADED", "AT_RISK", "DOWN", "UNKNOWN", "MAINTENANCE", "DISABLED"]);
const PROVENANCE_VALUES = new Set(["DECLARED", "DISCOVERED", "LEARNED"]);
const APPROVAL_VALUES = new Set(["PENDING", "APPROVED", "REJECTED", "IGNORED"]);
const TOPOLOGY_MODE_VALUES = new Set(["CENTRALISED", "DISTRIBUTED", "HYBRID"]);
const IMPACT_ROLE_SET = new Set<string>(IMPACT_ROLE_VALUES);

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const recordOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const listOperationalLocations = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const rows = await prisma.operationalLocation.findMany({
    where: { organizationId: orgId },
    orderBy: [{ type: "asc" }, { name: "asc" }]
  });
  res.json(rows);
};

export const createOperationalLocation = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (body.topologyMode !== undefined && body.topologyMode !== null && !TOPOLOGY_MODE_VALUES.has(String(body.topologyMode))) {
    res.status(400).json({ error: "topologyMode must be CENTRALISED, DISTRIBUTED, or HYBRID" });
    return;
  }
  const parentLocationId = body.parentLocationId ? String(body.parentLocationId) : null;
  if (parentLocationId) {
    const parent = await prisma.operationalLocation.findFirst({ where: { id: parentLocationId, organizationId: orgId }, select: { id: true } });
    if (!parent) {
      res.status(400).json({ error: "parentLocationId is not in your organization" });
      return;
    }
  }
  const row = await prisma.operationalLocation.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      parentLocationId,
      name,
      type: typeof body.type === "string" ? body.type.trim() || "SITE" : "SITE",
      topologyMode: typeof body.topologyMode === "string" ? body.topologyMode : null,
      regionCode: typeof body.regionCode === "string" ? body.regionCode : null,
      ...(recordOrNull(body.address) ? { addressJson: recordOrNull(body.address) as Prisma.InputJsonValue } : {}),
      ...(recordOrNull(body.metadata) ? { metadataJson: recordOrNull(body.metadata) as Prisma.InputJsonValue } : {}),
      updatedAt: new Date()
    }
  });
  res.status(201).json(row);
};

export const listOperationalGraph = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const provenance = typeof req.query.provenance === "string" ? req.query.provenance : undefined;
  const approvalStatus = typeof req.query.approvalStatus === "string" ? req.query.approvalStatus : undefined;
  const includePendingLearned =
    req.query.includePendingLearned === "true" ||
    req.query.includePendingLearned === "1" ||
    approvalStatus === "PENDING";

  if (provenance && !PROVENANCE_VALUES.has(provenance)) {
    res.status(400).json({ error: "provenance must be DECLARED, DISCOVERED, or LEARNED" });
    return;
  }
  if (approvalStatus && !APPROVAL_VALUES.has(approvalStatus)) {
    res.status(400).json({ error: "approvalStatus must be PENDING, APPROVED, REJECTED, or IGNORED" });
    return;
  }

  const relationshipWhere: Prisma.OperationalRelationshipWhereInput = {
    organizationId: orgId,
    ...(projectId ? { projectId } : {}),
    ...(provenance ? { provenance } : {}),
    ...(approvalStatus
      ? { approvalStatus }
      : includePendingLearned
        ? {}
        : {
            OR: [
              { approvalStatus: "APPROVED" },
              { provenance: { not: "LEARNED" } }
            ]
          })
  };

  const [entities, relationships] = await Promise.all([
    prisma.operationalEntity.findMany({
      where: {
        organizationId: orgId,
        ...(projectId ? { projectId } : {}),
        ...(locationId ? { operationalLocationId: locationId } : {}),
        ...(provenance ? { provenance } : {})
      },
      orderBy: { name: "asc" }
    }),
    prisma.operationalRelationship.findMany({
      where: relationshipWhere,
      orderBy: { createdAt: "desc" }
    })
  ]);
  const entityIds = new Set(entities.map((entity) => entity.id));
  res.json({
    entities,
    relationships: locationId
      ? relationships.filter((relationship) => entityIds.has(relationship.sourceEntityId) || entityIds.has(relationship.targetEntityId))
      : relationships,
    filters: {
      projectId: projectId ?? null,
      locationId: locationId ?? null,
      provenance: provenance ?? null,
      approvalStatus: approvalStatus ?? null,
      includePendingLearned,
      learnedTopologyEnabled: isLearnedTopologyEnabled()
    }
  });
};

export const getOperationalGraphHealthHandler = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const snapshot = await getOperationalGraphHealth({ organizationId: orgId, projectId, locationId });
  res.json(snapshot);
};

export const recalculateOperationalGraphHealthHandler = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  const locationId = typeof body.locationId === "string" ? body.locationId : undefined;
  const snapshot = await recalculateAndPersistOperationalGraphHealth({
    organizationId: orgId,
    projectId,
    locationId
  });
  res.json(snapshot);
};

export const createOperationalEntity = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const entityType = typeof body.entityType === "string" ? body.entityType.trim() : "";
  if (!name || !entityType) {
    res.status(400).json({ error: "name and entityType are required" });
    return;
  }
  const projectId = body.projectId ? String(body.projectId) : null;
  const operationalLocationId = body.operationalLocationId ? String(body.operationalLocationId) : null;
  const project = projectId
    ? await prisma.project.findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { id: true, environment: true }
      })
    : null;
  if (projectId && !project) {
    res.status(400).json({ error: "projectId is not in your organization" });
    return;
  }
  if (operationalLocationId && !(await prisma.operationalLocation.findFirst({ where: { id: operationalLocationId, organizationId: orgId }, select: { id: true } }))) {
    res.status(400).json({ error: "operationalLocationId is not in your organization" });
    return;
  }
  const provenance = typeof body.provenance === "string" ? body.provenance : "DECLARED";
  if (!PROVENANCE_VALUES.has(provenance)) {
    res.status(400).json({ error: "provenance must be DECLARED, DISCOVERED, or LEARNED" });
    return;
  }
  const health = typeof body.health === "string" ? body.health : "UNKNOWN";
  if (!HEALTH_VALUES.has(health)) {
    res.status(400).json({ error: "invalid health value" });
    return;
  }
  const row = await canonicalGraph.upsertEntity({
    organizationId: orgId,
    projectId,
    environment:
      project?.environment ??
      (typeof body.environment === "string" ? body.environment : "unknown"),
    entityType,
    stableKey:
      typeof body.stableKey === "string"
        ? body.stableKey
        : typeof body.externalId === "string"
          ? body.externalId
          : name,
    name,
    source: typeof body.discoverySource === "string" ? body.discoverySource : "MANUAL",
    sourceKey:
      typeof body.externalId === "string"
        ? body.externalId
        : typeof body.stableKey === "string"
          ? body.stableKey
          : name,
    provenance,
    operationalLocationId,
    criticality: typeof body.criticality === "string" ? body.criticality : "MEDIUM",
    health,
    healthReason: body.healthReason ? String(body.healthReason) : null,
    healthConfidence: typeof body.healthConfidence === "number" ? body.healthConfidence : null,
    confirmationState: "CONFIRMED",
    manuallyManaged: true,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((tag: unknown): tag is string => typeof tag === "string")
      : undefined,
    metadata: recordOrNull(body.metadata) as Prisma.InputJsonValue | undefined
  });
  res.status(201).json(row);
};

export const createOperationalRelationship = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const sourceEntityId = String(body.sourceEntityId || "");
  const targetEntityId = String(body.targetEntityId || "");
  const relationshipType = typeof body.relationshipType === "string" ? body.relationshipType.trim() : "";
  if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId || !relationshipType) {
    res.status(400).json({ error: "distinct sourceEntityId, targetEntityId, and relationshipType are required" });
    return;
  }
  const entities = await prisma.operationalEntity.findMany({
    where: { organizationId: orgId, id: { in: [sourceEntityId, targetEntityId] } },
    select: { id: true, projectId: true, environment: true }
  });
  if (entities.length !== 2) {
    res.status(400).json({ error: "relationship entities must belong to your organization" });
    return;
  }
  const sourceEntity = entities.find((entity) => entity.id === sourceEntityId)!;
  const targetEntity = entities.find((entity) => entity.id === targetEntityId)!;
  const provenance = typeof body.provenance === "string" ? body.provenance : "DECLARED";
  if (!PROVENANCE_VALUES.has(provenance)) {
    res.status(400).json({ error: "provenance must be DECLARED, DISCOVERED, or LEARNED" });
    return;
  }
  if (body.impactRole !== undefined && body.impactRole !== null && !IMPACT_ROLE_SET.has(String(body.impactRole))) {
    res.status(400).json({ error: "impactRole must be REQUIRED, OPTIONAL, REDUNDANT, DEGRADED, or BUSINESS_CRITICAL" });
    return;
  }
  const isLearned = provenance === "LEARNED";
  // Auto-approval of LEARNED is never allowed; discovery auto-create is gated separately.
  if (isLearned && body.autoApprove === true) {
    res.status(400).json({ error: "LEARNED relationships cannot be auto-approved" });
    return;
  }
  if (sourceEntity.environment !== targetEntity.environment) {
    res.status(409).json({ error: "relationship entities must use the same environment" });
    return;
  }
  const row = await canonicalGraph.upsertRelationship({
    organizationId: orgId,
    projectId:
      sourceEntity.projectId === targetEntity.projectId ? sourceEntity.projectId : null,
    environment: sourceEntity.environment,
    sourceEntityId,
    targetEntityId,
    relationshipType,
    source: "MANUAL",
    provenance,
    approvalStatus: isLearned ? "PENDING" : "APPROVED",
    requiresApproval: isLearned,
    impactRole: normalizeImpactRole(
      typeof body.impactRole === "string" ? body.impactRole : undefined
    ),
    criticality: typeof body.criticality === "string" ? body.criticality : "MEDIUM",
    confidence: typeof body.confidence === "number" ? body.confidence : null,
    confirmationState: isLearned ? "CANDIDATE" : "CONFIRMED",
    manuallyManaged: provenance === "DECLARED",
    evidence: recordOrNull(body.evidence) as Prisma.InputJsonValue | undefined
  });
  res.status(201).json(row);
};

/**
 * Manual LEARNED PENDING proposal (admin). Always PENDING; never auto-APPROVED.
 * Observation-driven auto discovery remains gated by OPSWATCH_LEARNED_TOPOLOGY_ENABLED.
 */
export const proposeLearnedOperationalRelationship = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const sourceEntityId = String(body.sourceEntityId || "");
  const targetEntityId = String(body.targetEntityId || "");
  const relationshipType = typeof body.relationshipType === "string" ? body.relationshipType.trim() : "";
  if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId || !relationshipType) {
    res.status(400).json({ error: "distinct sourceEntityId, targetEntityId, and relationshipType are required" });
    return;
  }
  const entities = await prisma.operationalEntity.findMany({
    where: { organizationId: orgId, id: { in: [sourceEntityId, targetEntityId] } },
    select: { id: true, projectId: true, environment: true }
  });
  if (entities.length !== 2) {
    res.status(400).json({ error: "relationship entities must belong to your organization" });
    return;
  }
  const sourceEntity = entities.find((entity) => entity.id === sourceEntityId)!;
  const targetEntity = entities.find((entity) => entity.id === targetEntityId)!;
  if (sourceEntity.environment !== targetEntity.environment) {
    res.status(409).json({ error: "relationship entities must use the same environment" });
    return;
  }
  if (body.impactRole !== undefined && body.impactRole !== null && !IMPACT_ROLE_SET.has(String(body.impactRole))) {
    res.status(400).json({ error: "impactRole must be REQUIRED, OPTIONAL, REDUNDANT, DEGRADED, or BUSINESS_CRITICAL" });
    return;
  }

  const existing = await prisma.operationalRelationship.findFirst({
    where: { organizationId: orgId, sourceEntityId, targetEntityId, relationshipType }
  });
  if (existing) {
    if (existing.provenance === "LEARNED" || existing.provenance === "DISCOVERED") {
      const strengthened = await observeOperationalRelationship({
        organizationId: orgId,
        relationshipId: existing.id,
        confidenceBoost: typeof body.confidenceBoost === "number" ? body.confidenceBoost : 0.05
      });
      res.status(200).json({
        relationship: strengthened.relationship ?? existing,
        learnedTopologyEnabled: isLearnedTopologyEnabled(),
        created: false,
        strengthened: strengthened.reason === "observed"
      });
      return;
    }
    res.status(409).json({ error: "relationship already exists", relationship: existing });
    return;
  }

  const row = await canonicalGraph.upsertRelationship({
    organizationId: orgId,
    projectId:
      sourceEntity.projectId === targetEntity.projectId
        ? sourceEntity.projectId
        : null,
    environment: sourceEntity.environment,
    sourceEntityId,
    targetEntityId,
    relationshipType,
    source: "LEARNED_API",
    provenance: "LEARNED",
    approvalStatus: "PENDING",
    requiresApproval: true,
    impactRole: normalizeImpactRole(
      typeof body.impactRole === "string" ? body.impactRole : undefined
    ),
    evidenceCount: 1,
    criticality:
      typeof body.criticality === "string" ? body.criticality : "MEDIUM",
    confidence: typeof body.confidence === "number" ? body.confidence : 0.55,
    confirmationState: "CANDIDATE",
    discoveryState: "CANDIDATE",
    evidence: recordOrNull(body.evidence) as Prisma.InputJsonValue | undefined
  });
  res.status(201).json({
    relationship: row,
    learnedTopologyEnabled: isLearnedTopologyEnabled(),
    created: true,
    strengthened: false
  });
};

export const observeOperationalRelationshipHandler = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const result = await observeOperationalRelationship({
    organizationId: orgId,
    relationshipId: typeof body.relationshipId === "string" ? body.relationshipId : undefined,
    sourceEntityId: typeof body.sourceEntityId === "string" ? body.sourceEntityId : undefined,
    targetEntityId: typeof body.targetEntityId === "string" ? body.targetEntityId : undefined,
    relationshipType: typeof body.relationshipType === "string" ? body.relationshipType : undefined,
    confidenceBoost: typeof body.confidenceBoost === "number" ? body.confidenceBoost : undefined
  });
  if (result.reason === "learned_topology_disabled" && !result.relationship) {
    res.status(404).json({
      error: "Relationship not found; auto-discovery requires OPSWATCH_LEARNED_TOPOLOGY_ENABLED=true",
      learnedTopologyEnabled: false
    });
    return;
  }
  if (!result.relationship) {
    res.status(404).json({ error: "Relationship not found", reason: result.reason });
    return;
  }
  if (result.reason === "provenance_not_observable") {
    res.status(400).json({ error: "Only DISCOVERED or LEARNED relationships accept observation bumps" });
    return;
  }
  res.json({ relationship: result.relationship, learnedTopologyEnabled: isLearnedTopologyEnabled() });
};

export const reviewLearnedOperationalRelationship = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const decision = req.body?.decision;
  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "IGNORE") {
    res.status(400).json({ error: "decision must be APPROVE, REJECT, or IGNORE" });
    return;
  }
  const existing = await prisma.operationalRelationship.findFirst({
    where: { id: req.params.relationshipId, organizationId: orgId, provenance: "LEARNED", requiresApproval: true }
  });
  if (!existing) {
    res.status(404).json({ error: "Pending learned relationship not found" });
    return;
  }
  const approved = decision === "APPROVE";
  const row = await prisma.operationalRelationship.update({
    where: { id: existing.id },
    data: {
      approvalStatus: approved ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "IGNORED",
      lifecycle: approved ? "ACTIVE" : "INACTIVE",
      requiresApproval: false,
      updatedAt: new Date()
    }
  });
  res.json(row);
};
