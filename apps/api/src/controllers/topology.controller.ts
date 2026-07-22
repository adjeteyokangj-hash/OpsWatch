import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import type {
  ProjectTopologyResponse,
  TopologyHealthStatus
} from "../types/dto";
import { loadProjectTopology } from "../services/topology-loader.service";
import { getRelationshipIncidentMemorySignals as fetchRelationshipIncidentMemorySignals } from "../services/ai/relationship-incident-memory.service";
import { resolveInheritedModuleSignal } from "../services/project-loader.service";
import { worstHealth } from "../services/service-health.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const topologyHealthFromSignal = (status: string): TopologyHealthStatus => {
  if (status === "DOWN") return "CRITICAL";
  if (status === "DEGRADED" || status === "PAUSED") return "DEGRADED";
  return "HEALTHY";
};

/**
 * Imported modules are logical areas inside the connected application. They do
 * not each need an invented URL check. Apply the same real application signal
 * used by the Modules inventory to either legacy Service IDs or canonical
 * OperationalEntity IDs, while preserving any worse alert/check evidence.
 */
const overlayInheritedModuleHealth = async (params: {
  organizationId: string;
  projectId: string;
  topology: ProjectTopologyResponse;
}): Promise<ProjectTopologyResponse> => {
  try {
    const [heartbeats, connections, modules] = await Promise.all([
      prisma.heartbeat.findMany({
        where: { projectId: params.projectId },
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: { receivedAt: true, status: true, message: true }
      }),
      prisma.connection.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          isActive: true,
          mode: "API"
        },
        select: {
          id: true,
          name: true,
          mode: true,
          health: true,
          healthReason: true,
          installationStatus: true,
          lastSuccessAt: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          syncIntervalMinutes: true
        }
      }),
      prisma.service.findMany({
        where: {
          projectId: params.projectId,
          type: "MODULE",
          OutgoingDependencies: {
            some: {
              dependencyType: "HIERARCHY",
              source: "CONNECTION_DISCOVERY",
              isActive: true
            }
          }
        },
        select: {
          id: true,
          Check: {
            where: { isActive: true },
            select: { id: true }
          }
        }
      })
    ]);

    const signal = resolveInheritedModuleSignal({
      Heartbeat: heartbeats,
      Connection: connections
    } as never);
    if (!signal) return params.topology;

    const eligibleServiceIds = modules
      .filter((module) => module.Check.length === 0)
      .map((module) => module.id);
    if (eligibleServiceIds.length === 0) return params.topology;

    const mappings = await prisma.legacyServiceEntityMapping.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        status: "ACTIVE",
        legacyServiceId: { in: eligibleServiceIds }
      },
      select: { legacyServiceId: true, entityId: true }
    });

    const eligibleNodeIds = new Set<string>([
      ...eligibleServiceIds,
      ...mappings.map((mapping) => mapping.entityId)
    ]);
    const inheritedHealth = topologyHealthFromSignal(signal.status);
    const signalAt = signal.observedAt.toISOString();

    const nodes = params.topology.nodes.map((node) => {
      if (!eligibleNodeIds.has(node.id) || node.type !== "MODULE") return node;
      const status =
        node.status === "UNKNOWN"
          ? inheritedHealth
          : worstHealth([node.status, inheritedHealth]);
      return { ...node, status };
    });

    const nodeContext = { ...params.topology.nodeContext };
    for (const node of nodes) {
      if (!eligibleNodeIds.has(node.id) || node.type !== "MODULE") continue;
      const context = nodeContext[node.id];
      if (!context) continue;
      nodeContext[node.id] = {
        ...context,
        monitoringState: "MONITORED",
        lastCheckAt: signalAt,
        lastCheckStatus: signal.displayLabel
      };
    }

    return {
      ...params.topology,
      nodes,
      nodeContext,
      summary: {
        ...params.topology.summary,
        total: nodes.length,
        healthy: nodes.filter((node) => node.status === "HEALTHY").length,
        degraded: nodes.filter((node) => node.status === "DEGRADED").length,
        critical: nodes.filter((node) => node.status === "CRITICAL").length,
        unknown: nodes.filter((node) => node.status === "UNKNOWN").length
      }
    };
  } catch (error) {
    console.warn("TOPOLOGY_APPLICATION_SIGNAL_OVERLAY_FAILED", {
      projectId: params.projectId,
      message: error instanceof Error ? error.message : String(error)
    });
    return params.topology;
  }
};

export const getProjectTopology = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const projectId = String(req.params.projectId);
  const topology = await loadProjectTopology(orgId, projectId);
  if (!topology) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const resolvedTopology = await overlayInheritedModuleHealth({
    organizationId: orgId,
    projectId,
    topology
  });
  res.json(resolvedTopology);
};

export const getRelationshipIncidentMemorySignals = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const projectId = String(req.params.projectId);
  const edgeId = String(req.params.edgeId);

  const signals = await fetchRelationshipIncidentMemorySignals({
    organizationId: orgId,
    projectId,
    edgeId
  });

  res.json(signals);
};
