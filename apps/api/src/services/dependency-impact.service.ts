import type { ServiceType } from "@prisma/client";

export type HealthLayer = "APP" | "MODULE" | "WORKFLOW" | "COMPONENT";

export type LayerImpactStatus = "ROOT_CAUSE" | "AFFECTED" | "DEGRADED" | "UNAFFECTED";

export interface DependencyEdge {
  fromServiceId: string;
  toServiceId: string;
  dependencyType: string;
  criticality: string;
}

export interface ServiceNode {
  id: string;
  name: string;
  type: ServiceType;
  status?: string;
}

export interface LayerImpact {
  layer: HealthLayer;
  serviceId: string;
  serviceName: string;
  status: LayerImpactStatus;
  rationale: string;
}

export interface DependencyImpactAnalysis {
  probableRootCause: {
    serviceId: string;
    serviceName: string;
    layer: HealthLayer;
    rationale: string;
  } | null;
  propagationChain: Array<{
    fromServiceId: string;
    fromServiceName: string;
    toServiceId: string;
    toServiceName: string;
    relationship: string;
  }>;
  layerImpacts: LayerImpact[];
  narrative: string;
  appHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  propagationPath: Array<{
    serviceId: string;
    serviceName: string;
    layer: HealthLayer;
    status: LayerImpactStatus;
  }>;
}

const infrastructuralLayers = new Set<HealthLayer>(["COMPONENT"]);

export const resolveHealthLayer = (type: ServiceType): HealthLayer => {
  if (type === "APP") return "APP";
  if (type === "MODULE") return "MODULE";
  if (type === "WORKFLOW") return "WORKFLOW";
  return "COMPONENT";
};

const layerRank: Record<HealthLayer, number> = {
  COMPONENT: 0,
  WORKFLOW: 1,
  MODULE: 2,
  APP: 3
};

const runtimeEdges = (edges: DependencyEdge[]): DependencyEdge[] =>
  edges.filter((edge) => edge.dependencyType.toUpperCase() === "RUNTIME");

const hierarchyEdges = (edges: DependencyEdge[]): DependencyEdge[] =>
  edges.filter((edge) => edge.dependencyType.toUpperCase() === "HIERARCHY");

const buildUpstreamMap = (edges: DependencyEdge[]): Map<string, string[]> => {
  const upstream = new Map<string, string[]>();
  for (const edge of edges) {
    if (!upstream.has(edge.fromServiceId)) upstream.set(edge.fromServiceId, []);
    upstream.get(edge.fromServiceId)!.push(edge.toServiceId);
  }
  return upstream;
};

const buildDownstreamMap = (edges: DependencyEdge[]): Map<string, string[]> => {
  const downstream = new Map<string, string[]>();
  for (const edge of edges) {
    if (!downstream.has(edge.toServiceId)) downstream.set(edge.toServiceId, []);
    downstream.get(edge.toServiceId)!.push(edge.fromServiceId);
  }
  return downstream;
};

const collectUpstream = (serviceId: string, upstream: Map<string, string[]>): Set<string> => {
  const found = new Set<string>();
  const queue = [...(upstream.get(serviceId) ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (found.has(current)) continue;
    found.add(current);
    queue.push(...(upstream.get(current) ?? []));
  }
  return found;
};

const collectDownstream = (serviceId: string, downstream: Map<string, string[]>): Set<string> => {
  const found = new Set<string>();
  const queue = [...(downstream.get(serviceId) ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (found.has(current)) continue;
    found.add(current);
    queue.push(...(downstream.get(current) ?? []));
  }
  return found;
};

const buildHierarchyParentMap = (edges: DependencyEdge[]): Map<string, string> => {
  const parents = new Map<string, string>();
  for (const edge of hierarchyEdges(edges)) {
    parents.set(edge.fromServiceId, edge.toServiceId);
  }
  return parents;
};

const ancestorsInHierarchy = (
  serviceId: string,
  parents: Map<string, string>
): string[] => {
  const found: string[] = [];
  let current: string | undefined = serviceId;
  while (current) {
    const parent = parents.get(current);
    if (!parent) break;
    found.push(parent);
    current = parent;
  }
  return found;
};

const pickRootCause = (
  impactedServiceIds: Set<string>,
  services: ServiceNode[],
  upstream: Map<string, string[]>,
  failingServiceIds: Set<string>
): ServiceNode | null => {
  const serviceById = new Map(services.map((row) => [row.id, row]));
  const candidateIds = new Set<string>(impactedServiceIds);

  for (const serviceId of impactedServiceIds) {
    for (const upstreamId of collectUpstream(serviceId, upstream)) {
      if (failingServiceIds.has(upstreamId) || impactedServiceIds.has(upstreamId)) {
        candidateIds.add(upstreamId);
      }
    }
  }

  const candidates = [...candidateIds]
    .map((id) => serviceById.get(id))
    .filter((row): row is ServiceNode => Boolean(row));

  if (candidates.length === 0) return null;

  const roots = candidates.filter((service) => {
    const parents = [...collectUpstream(service.id, upstream)].filter((parentId) =>
      candidateIds.has(parentId)
    );
    return parents.length === 0;
  });

  const finalCandidates = roots.length > 0 ? roots : candidates;
  return [...finalCandidates].sort((a, b) => {
    const infraA = infrastructuralLayers.has(resolveHealthLayer(a.type)) ? 0 : 1;
    const infraB = infrastructuralLayers.has(resolveHealthLayer(b.type)) ? 0 : 1;
    if (infraA !== infraB) return infraA - infraB;
    return layerRank[resolveHealthLayer(a.type)] - layerRank[resolveHealthLayer(b.type)];
  })[0]!;
};

export const analyzeDependencyImpact = (input: {
  projectName: string;
  services: ServiceNode[];
  edges: DependencyEdge[];
  impactedServiceIds: string[];
  failingServiceIds?: string[];
}): DependencyImpactAnalysis => {
  const serviceById = new Map(input.services.map((row) => [row.id, row]));
  const impacted = new Set(input.impactedServiceIds);
  const failing = new Set(input.failingServiceIds ?? input.impactedServiceIds);
  const runtime = runtimeEdges(input.edges);
  const hierarchy = hierarchyEdges(input.edges);
  const upstream = buildUpstreamMap(runtime);
  const downstream = buildDownstreamMap(runtime);
  const hierarchyParents = buildHierarchyParentMap(hierarchy);

  const root = pickRootCause(impacted, input.services, upstream, failing);
  const runtimeBlast = root ? collectDownstream(root.id, downstream) : new Set<string>();
  const runtimeAffected = new Set<string>([...impacted, ...runtimeBlast, ...(root ? [root.id] : [])]);

  const propagationChain: DependencyImpactAnalysis["propagationChain"] = [];
  if (root) {
    const queue = [root.id];
    const visited = new Set<string>([root.id]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of runtime) {
        if (edge.toServiceId !== current || visited.has(edge.fromServiceId)) continue;
        visited.add(edge.fromServiceId);
        queue.push(edge.fromServiceId);
        propagationChain.push({
          fromServiceId: edge.fromServiceId,
          fromServiceName: serviceById.get(edge.fromServiceId)?.name ?? edge.fromServiceId,
          toServiceId: edge.toServiceId,
          toServiceName: serviceById.get(edge.toServiceId)?.name ?? edge.toServiceId,
          relationship: `${serviceById.get(edge.fromServiceId)?.name ?? "Service"} depends on ${serviceById.get(edge.toServiceId)?.name ?? "dependency"}`
        });
      }
    }
  }

  const moduleTouchedByRuntime = (moduleId: string): boolean => {
    for (const serviceId of runtimeAffected) {
      const ancestors = ancestorsInHierarchy(serviceId, hierarchyParents);
      if (ancestors.includes(moduleId) || serviceId === moduleId) {
        return true;
      }
    }
    return false;
  };

  const moduleServices = input.services.filter((row) => resolveHealthLayer(row.type) === "MODULE");
  const isModuleImpacted = (moduleId: string): boolean =>
    moduleTouchedByRuntime(moduleId) || runtimeAffected.has(moduleId);
  const impactedModuleCount = moduleServices.filter((row) => isModuleImpacted(row.id)).length;

  const appPartiallyDegraded = (): boolean => {
    if (moduleServices.length > 0) {
      return impactedModuleCount > 0 && impactedModuleCount < moduleServices.length;
    }
    const nonAppServices = input.services.filter((row) => resolveHealthLayer(row.type) !== "APP");
    const affectedNonApp = nonAppServices.filter((row) => runtimeAffected.has(row.id)).length;
    return affectedNonApp > 0 && affectedNonApp < nonAppServices.length;
  };

  const layerImpacts: LayerImpact[] = input.services.map((service) => {
    const layer = resolveHealthLayer(service.type);

    if (root && service.id === root.id) {
      return {
        layer,
        serviceId: service.id,
        serviceName: service.name,
        status: "ROOT_CAUSE",
        rationale: "Upstream-most failing runtime dependency in the incident graph."
      };
    }

    if (runtimeAffected.has(service.id)) {
      if (layer === "MODULE") {
        return {
          layer,
          serviceId: service.id,
          serviceName: service.name,
          status: "DEGRADED",
          rationale: "A workflow or component in this module is affected, but the module is not fully down."
        };
      }

      if (layer === "APP") {
        const partial = appPartiallyDegraded();
        return {
          layer,
          serviceId: service.id,
          serviceName: service.name,
          status: partial ? "DEGRADED" : "AFFECTED",
          rationale: partial
            ? "One or more modules are affected; the app remains partially available."
            : "All scoped modules are affected by the runtime blast radius."
        };
      }

      return {
        layer,
        serviceId: service.id,
        serviceName: service.name,
        status: "AFFECTED",
        rationale: root
          ? `Runtime blast radius from ${root.name}.`
          : "Linked to incident alerts."
      };
    }

    if (layer === "MODULE" && moduleTouchedByRuntime(service.id)) {
      return {
        layer,
        serviceId: service.id,
        serviceName: service.name,
        status: "DEGRADED",
        rationale: "A workflow or component in this module is affected, but the module is not fully down."
      };
    }

    if (layer === "APP") {
      const anyModuleDegraded = moduleServices.some((row) => isModuleImpacted(row.id));
      if (anyModuleDegraded && appPartiallyDegraded()) {
        return {
          layer,
          serviceId: service.id,
          serviceName: service.name,
          status: "DEGRADED",
          rationale: "One or more modules are affected; the app remains partially available."
        };
      }
    }

    return {
      layer,
      serviceId: service.id,
      serviceName: service.name,
      status: "UNAFFECTED",
      rationale: "Outside the runtime blast radius for this incident."
    };
  });

  const unaffectedModules = layerImpacts
    .filter((row) => row.layer === "MODULE" && row.status === "UNAFFECTED")
    .map((row) => row.serviceName);

  const appImpact = layerImpacts.find((row) => row.layer === "APP");
  const appHealth: DependencyImpactAnalysis["appHealth"] =
    appImpact?.status === "DEGRADED"
      ? "DEGRADED"
      : appImpact?.status === "AFFECTED"
        ? "DOWN"
        : "HEALTHY";

  const impactByServiceId = new Map(layerImpacts.map((row) => [row.serviceId, row]));
  const propagationPath: DependencyImpactAnalysis["propagationPath"] = [];
  if (root) {
    let current: ServiceNode | null = root;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const impact = impactByServiceId.get(current.id);
      propagationPath.push({
        serviceId: current.id,
        serviceName: current.name,
        layer: resolveHealthLayer(current.type),
        status: impact?.status ?? (current.id === root.id ? "ROOT_CAUSE" : "AFFECTED")
      });
      const downstream = runtime
        .filter((edge) => edge.toServiceId === current!.id && runtimeAffected.has(edge.fromServiceId))
        .map((edge) => serviceById.get(edge.fromServiceId))
        .filter((row): row is ServiceNode => Boolean(row))
        .filter((row) => !visited.has(row.id))
        .sort(
          (a, b) =>
            layerRank[resolveHealthLayer(b.type)] - layerRank[resolveHealthLayer(a.type)]
        );
      current = downstream[0] ?? null;
    }
  }

  let narrative = "No runtime dependency graph was available for layered root-cause analysis.";
  if (root) {
    const directVictims = [...runtimeAffected]
      .map((id) => serviceById.get(id)?.name)
      .filter((name): name is string => Boolean(name))
      .filter((name) => name !== root.name);

    narrative = [
      `Root cause: ${root.name} (${resolveHealthLayer(root.type)}) is the probable upstream failure.`,
      directVictims.length > 0 ? `Affected scope includes ${directVictims.join(", ")}.` : null,
      unaffectedModules.length > 0 ? `${unaffectedModules.join(", ")} remain healthy.` : null,
      `${input.projectName} is ${appHealth === "DEGRADED" ? "partially degraded" : appHealth === "DOWN" ? "down" : "healthy"}.`
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    probableRootCause: root
      ? {
          serviceId: root.id,
          serviceName: root.name,
          layer: resolveHealthLayer(root.type),
          rationale: "Selected as the upstream-most failing node in the runtime dependency graph."
        }
      : null,
    propagationChain,
    layerImpacts: layerImpacts.sort((a, b) => layerRank[a.layer] - layerRank[b.layer]),
    narrative,
    appHealth,
    propagationPath
  };
};
