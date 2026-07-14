/**
 * Idempotent StarLiz Academy four-layer reliability graph.
 * Stable external keys: svc-sa-* and dep-sa-*
 *
 * Requires project to already exist (Create via OpsWatch wizard):
 *   STARLIZ_ACADEMY_PROJECT_SLUG=starliz-academy
 */
import { PrismaClient, ProjectStatus, ServiceType } from "@prisma/client";

const PROJECT_SLUG = process.env.STARLIZ_ACADEMY_PROJECT_SLUG?.trim() || "starliz-academy";
const PREFIX = "sa";
const PUBLIC_BASE = process.env.STARLIZ_ACADEMY_PUBLIC_URL?.trim() || "https://www.starlizacademy.com";

export const starlizAcademyProjectSlug = PROJECT_SLUG;
export const serviceId = (key: string): string => `svc-${PREFIX}-${key}`;
export const dependencyId = (fromKey: string, toKey: string, type: string): string =>
  `dep-${PREFIX}-${fromKey}-${toKey}-${type.toLowerCase()}`;

type LayerType = "APP" | "MODULE" | "WORKFLOW" | "COMPONENT";

type ServiceSeed = {
  key: string;
  name: string;
  layer: LayerType;
  isCritical?: boolean;
  baseUrl?: string | null;
};

const services: ServiceSeed[] = [
  { key: "starliz-academy", name: "StarLiz Academy", layer: "APP", isCritical: true, baseUrl: PUBLIC_BASE },
  { key: "learning", name: "Learning", layer: "MODULE", isCritical: true },
  { key: "billing", name: "Billing", layer: "MODULE" },
  { key: "admin", name: "Admin", layer: "MODULE" },
  { key: "integrations", name: "Integrations", layer: "MODULE" },
  { key: "assignment-loop", name: "Assignment Loop", layer: "WORKFLOW", isCritical: true },
  { key: "parent-portal", name: "Parent Portal", layer: "WORKFLOW" },
  { key: "truenumeris-sync", name: "TrueNumeris Sync", layer: "WORKFLOW" },
  { key: "api-health", name: "API Health", layer: "COMPONENT", isCritical: true, baseUrl: `${PUBLIC_BASE}/api/health` },
  { key: "postgres", name: "PostgreSQL", layer: "COMPONENT", isCritical: true },
  { key: "cron-jobs", name: "Cron Jobs", layer: "COMPONENT" },
  { key: "media-storage", name: "Media / Object Storage", layer: "COMPONENT" },
];

type HierarchyEdge = { child: string; parent: string };
type RuntimeEdge = { from: string; to: string; criticality?: string };

const hierarchyEdges: HierarchyEdge[] = [
  { child: "learning", parent: "starliz-academy" },
  { child: "billing", parent: "starliz-academy" },
  { child: "admin", parent: "starliz-academy" },
  { child: "integrations", parent: "starliz-academy" },
  { child: "assignment-loop", parent: "learning" },
  { child: "parent-portal", parent: "learning" },
  { child: "truenumeris-sync", parent: "integrations" },
  { child: "api-health", parent: "starliz-academy" },
  { child: "postgres", parent: "assignment-loop" },
  { child: "cron-jobs", parent: "admin" },
  { child: "media-storage", parent: "learning" },
];

const runtimeEdges: RuntimeEdge[] = [
  { from: "assignment-loop", to: "postgres", criticality: "CRITICAL" },
  { from: "learning", to: "assignment-loop", criticality: "HIGH" },
  { from: "starliz-academy", to: "learning", criticality: "HIGH" },
  { from: "truenumeris-sync", to: "api-health", criticality: "MEDIUM" },
  { from: "parent-portal", to: "postgres", criticality: "HIGH" },
];

const toServiceType = (layer: LayerType): ServiceType => layer as ServiceType;

export const seedStarlizAcademyGraph = async (prisma: PrismaClient): Promise<{
  projectId: string;
  serviceCount: number;
  dependencyCount: number;
}> => {
  const project = await prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
  if (!project) {
    throw new Error(
      `Project '${PROJECT_SLUG}' not found. Create StarLiz Academy in OpsWatch and set STARLIZ_ACADEMY_PROJECT_SLUG.`,
    );
  }

  const now = new Date();
  for (const row of services) {
    await prisma.service.upsert({
      where: { id: serviceId(row.key) },
      update: {
        name: row.name,
        type: toServiceType(row.layer),
        isCritical: row.isCritical ?? false,
        baseUrl: row.baseUrl ?? null,
        updatedAt: now,
      },
      create: {
        id: serviceId(row.key),
        projectId: project.id,
        name: row.name,
        type: toServiceType(row.layer),
        status: ProjectStatus.HEALTHY,
        isCritical: row.isCritical ?? false,
        baseUrl: row.baseUrl ?? null,
        updatedAt: now,
      },
    });
  }

  let dependencyCount = 0;
  for (const edge of hierarchyEdges) {
    await prisma.serviceDependency.upsert({
      where: {
        fromServiceId_toServiceId_dependencyType: {
          fromServiceId: serviceId(edge.child),
          toServiceId: serviceId(edge.parent),
          dependencyType: "HIERARCHY",
        },
      },
      update: { isActive: true, criticality: "HIGH", updatedAt: now },
      create: {
        id: dependencyId(edge.child, edge.parent, "hierarchy"),
        projectId: project.id,
        fromServiceId: serviceId(edge.child),
        toServiceId: serviceId(edge.parent),
        dependencyType: "HIERARCHY",
        criticality: "HIGH",
        isActive: true,
        updatedAt: now,
      },
    });
    dependencyCount += 1;
  }

  for (const edge of runtimeEdges) {
    await prisma.serviceDependency.upsert({
      where: {
        fromServiceId_toServiceId_dependencyType: {
          fromServiceId: serviceId(edge.from),
          toServiceId: serviceId(edge.to),
          dependencyType: "RUNTIME",
        },
      },
      update: {
        isActive: true,
        criticality: edge.criticality ?? "HIGH",
        updatedAt: now,
      },
      create: {
        id: dependencyId(edge.from, edge.to, "runtime"),
        projectId: project.id,
        fromServiceId: serviceId(edge.from),
        toServiceId: serviceId(edge.to),
        dependencyType: "RUNTIME",
        criticality: edge.criticality ?? "HIGH",
        isActive: true,
        updatedAt: now,
      },
    });
    dependencyCount += 1;
  }

  return { projectId: project.id, serviceCount: services.length, dependencyCount };
};
