import { randomUUID } from "crypto";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

const HEALTH_VALUES = new Set(["HEALTHY", "DEGRADED", "AT_RISK", "DOWN", "UNKNOWN", "MAINTENANCE", "DISABLED"]);
const PROVENANCE_VALUES = new Set(["DECLARED", "DISCOVERED", "LEARNED"]);
const TOPOLOGY_MODE_VALUES = new Set(["CENTRALISED", "DISTRIBUTED", "HYBRID"]);

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
  const [entities, relationships] = await Promise.all([
    prisma.operationalEntity.findMany({
      where: { organizationId: orgId, ...(projectId ? { projectId } : {}), ...(locationId ? { operationalLocationId: locationId } : {}) },
      orderBy: { name: "asc" }
    }),
    prisma.operationalRelationship.findMany({
      where: { organizationId: orgId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const entityIds = new Set(entities.map((entity) => entity.id));
  res.json({
    entities,
    relationships: locationId
      ? relationships.filter((relationship) => entityIds.has(relationship.sourceEntityId) || entityIds.has(relationship.targetEntityId))
      : relationships
  });
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
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } }))) {
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
  const row = await prisma.operationalEntity.create({
    data: {
      id: randomUUID(), organizationId: orgId, projectId, operationalLocationId, name, entityType,
      externalId: body.externalId ? String(body.externalId) : null,
      criticality: typeof body.criticality === "string" ? body.criticality : "MEDIUM",
      health, healthOverride: body.healthOverride && HEALTH_VALUES.has(String(body.healthOverride)) ? String(body.healthOverride) : null,
      healthReason: body.healthReason ? String(body.healthReason) : null,
      healthConfidence: typeof body.healthConfidence === "number" ? body.healthConfidence : null,
      provenance, discoverySource: body.discoverySource ? String(body.discoverySource) : null,
      discoveredAt: provenance === "DECLARED" ? null : new Date(),
      ...(Array.isArray(body.tags) ? { tagsJson: body.tags.filter((tag: unknown): tag is string => typeof tag === "string") } : {}),
      ...(recordOrNull(body.metadata) ? { metadataJson: recordOrNull(body.metadata) as Prisma.InputJsonValue } : {}),
      updatedAt: new Date()
    }
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
    select: { id: true, projectId: true }
  });
  const [sourceEntity, targetEntity] = entities;
  if (entities.length !== 2 || !sourceEntity || !targetEntity) {
    res.status(400).json({ error: "relationship entities must belong to your organization" });
    return;
  }
  const provenance = typeof body.provenance === "string" ? body.provenance : "DECLARED";
  if (!PROVENANCE_VALUES.has(provenance)) {
    res.status(400).json({ error: "provenance must be DECLARED, DISCOVERED, or LEARNED" });
    return;
  }
  const isLearned = provenance === "LEARNED";
  const row = await prisma.operationalRelationship.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      projectId: sourceEntity.projectId === targetEntity.projectId ? sourceEntity.projectId : null,
      sourceEntityId, targetEntityId, relationshipType, provenance,
      approvalStatus: isLearned ? "PENDING" : "APPROVED",
      requiresApproval: isLearned,
      criticality: typeof body.criticality === "string" ? body.criticality : "MEDIUM",
      confidence: typeof body.confidence === "number" ? body.confidence : null,
      ...(recordOrNull(body.evidence) ? { evidenceJson: recordOrNull(body.evidence) as Prisma.InputJsonValue } : {}),
      discoveredAt: provenance === "DECLARED" ? null : new Date(),
      updatedAt: new Date()
    }
  });
  res.status(201).json(row);
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
  const row = await prisma.operationalRelationship.update({
    where: { id: existing.id },
    data: { approvalStatus: decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "IGNORED", lifecycle: decision === "APPROVE" ? "ACTIVE" : "INACTIVE", updatedAt: new Date() }
  });
  res.json(row);
};
