/**
 * Idempotent Noble Express four-layer reliability graph.
 * Stable external keys: svc-ne-* and dep-ne-*
 */
import { PrismaClient, ProjectStatus, ServiceType } from "@prisma/client";

const PROJECT_SLUG = process.env.NOBLE_EXPRESS_PROJECT_SLUG?.trim() || "noble-express";
const PREFIX = "ne";

export const nobleExpressProjectSlug = PROJECT_SLUG;
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
  { key: "noble-express", name: "Noble Express", layer: "APP", isCritical: true },
  { key: "quotes", name: "Quotes", layer: "MODULE", isCritical: true },
  { key: "shipments", name: "Shipments", layer: "MODULE" },
  { key: "tracking", name: "Tracking", layer: "MODULE" },
  { key: "communications", name: "Communications", layer: "MODULE" },
  { key: "payments", name: "Payments", layer: "MODULE" },
  { key: "truenumeris-integration", name: "TrueNumeris Integration", layer: "MODULE" },
  { key: "customer-quote-journey", name: "Customer Quote Journey", layer: "WORKFLOW", isCritical: true },
  { key: "quote-acceptance-journey", name: "Quote Acceptance Journey", layer: "WORKFLOW" },
  { key: "shipment-creation", name: "Shipment Creation", layer: "WORKFLOW" },
  { key: "collection-scheduling", name: "Collection Scheduling", layer: "WORKFLOW" },
  { key: "release-of-goods", name: "Release of Goods", layer: "WORKFLOW" },
  { key: "tracking-update-flow", name: "Tracking Update Flow", layer: "WORKFLOW" },
  { key: "customer-tracking-journey", name: "Customer Tracking Journey", layer: "WORKFLOW" },
  { key: "email-notification-flow", name: "Email Notification Flow", layer: "WORKFLOW" },
  { key: "whatsapp-communication-flow", name: "WhatsApp Communication Flow", layer: "WORKFLOW" },
  { key: "payment-initiation", name: "Payment Initiation", layer: "WORKFLOW" },
  { key: "payment-verification", name: "Payment Verification", layer: "WORKFLOW" },
  { key: "contact-synchronisation", name: "Contact Synchronisation", layer: "WORKFLOW" },
  { key: "invoice-synchronisation", name: "Invoice Synchronisation", layer: "WORKFLOW" },
  { key: "quote-api", name: "Quote API", layer: "COMPONENT", isCritical: true, baseUrl: "http://127.0.0.1:4999/quote-api" },
  { key: "pricing-engine", name: "Pricing Engine", layer: "COMPONENT", isCritical: true, baseUrl: "http://127.0.0.1:4999/pricing" },
  { key: "postgresql", name: "PostgreSQL", layer: "COMPONENT", isCritical: true },
  { key: "redis", name: "Redis", layer: "COMPONENT", isCritical: true, baseUrl: "http://127.0.0.1:4999/redis" },
  { key: "email-service", name: "Email Service", layer: "COMPONENT" },
  { key: "customer-portal", name: "Customer Portal", layer: "COMPONENT", baseUrl: "https://www.noblexp.com" },
  { key: "integration-outbox", name: "Integration Outbox", layer: "COMPONENT" },
  { key: "truenumeris-api", name: "TrueNumeris API", layer: "COMPONENT" }
];

type HierarchyEdge = { child: string; parent: string };
type RuntimeEdge = { from: string; to: string; criticality?: string };

const hierarchyEdges: HierarchyEdge[] = [
  { child: "quotes", parent: "noble-express" },
  { child: "shipments", parent: "noble-express" },
  { child: "tracking", parent: "noble-express" },
  { child: "communications", parent: "noble-express" },
  { child: "payments", parent: "noble-express" },
  { child: "truenumeris-integration", parent: "noble-express" },
  { child: "customer-quote-journey", parent: "quotes" },
  { child: "quote-acceptance-journey", parent: "quotes" },
  { child: "quote-api", parent: "customer-quote-journey" },
  { child: "pricing-engine", parent: "customer-quote-journey" },
  { child: "postgresql", parent: "customer-quote-journey" },
  { child: "redis", parent: "customer-quote-journey" },
  { child: "quote-api", parent: "quote-acceptance-journey" },
  { child: "email-service", parent: "quote-acceptance-journey" },
  { child: "customer-portal", parent: "quote-acceptance-journey" },
  { child: "shipment-creation", parent: "shipments" },
  { child: "collection-scheduling", parent: "shipments" },
  { child: "release-of-goods", parent: "shipments" },
  { child: "tracking-update-flow", parent: "tracking" },
  { child: "customer-tracking-journey", parent: "tracking" },
  { child: "email-notification-flow", parent: "communications" },
  { child: "whatsapp-communication-flow", parent: "communications" },
  { child: "payment-initiation", parent: "payments" },
  { child: "payment-verification", parent: "payments" },
  { child: "contact-synchronisation", parent: "truenumeris-integration" },
  { child: "invoice-synchronisation", parent: "truenumeris-integration" },
  { child: "integration-outbox", parent: "truenumeris-integration" },
  { child: "truenumeris-api", parent: "truenumeris-integration" }
];

const runtimeEdges: RuntimeEdge[] = [
  { from: "pricing-engine", to: "redis", criticality: "CRITICAL" },
  { from: "quote-api", to: "pricing-engine", criticality: "CRITICAL" },
  { from: "quote-api", to: "postgresql", criticality: "CRITICAL" },
  { from: "customer-quote-journey", to: "quote-api", criticality: "CRITICAL" },
  { from: "quotes", to: "customer-quote-journey", criticality: "HIGH" },
  { from: "noble-express", to: "quotes", criticality: "HIGH" },
  { from: "quote-acceptance-journey", to: "quote-api", criticality: "MEDIUM" },
  { from: "integration-outbox", to: "truenumeris-api", criticality: "CRITICAL" },
  { from: "contact-synchronisation", to: "integration-outbox", criticality: "HIGH" },
  { from: "truenumeris-integration", to: "contact-synchronisation", criticality: "HIGH" }
];

const toServiceType = (layer: LayerType): ServiceType => layer as ServiceType;

export const seedNobleExpressGraph = async (prisma: PrismaClient): Promise<{
  projectId: string;
  serviceCount: number;
  dependencyCount: number;
}> => {
  const project = await prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
  if (!project) {
    throw new Error(`Project '${PROJECT_SLUG}' not found. Create Noble Express before seeding the graph.`);
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
        updatedAt: now
      },
      create: {
        id: serviceId(row.key),
        projectId: project.id,
        name: row.name,
        type: toServiceType(row.layer),
        status: ProjectStatus.HEALTHY,
        isCritical: row.isCritical ?? false,
        baseUrl: row.baseUrl ?? null,
        updatedAt: now
      }
    });
  }

  let dependencyCount = 0;
  for (const edge of hierarchyEdges) {
    await prisma.serviceDependency.upsert({
      where: {
        fromServiceId_toServiceId_dependencyType: {
          fromServiceId: serviceId(edge.child),
          toServiceId: serviceId(edge.parent),
          dependencyType: "HIERARCHY"
        }
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
        updatedAt: now
      }
    });
    dependencyCount += 1;
  }

  for (const edge of runtimeEdges) {
    await prisma.serviceDependency.upsert({
      where: {
        fromServiceId_toServiceId_dependencyType: {
          fromServiceId: serviceId(edge.from),
          toServiceId: serviceId(edge.to),
          dependencyType: "RUNTIME"
        }
      },
      update: {
        isActive: true,
        criticality: edge.criticality ?? "HIGH",
        updatedAt: now
      },
      create: {
        id: dependencyId(edge.from, edge.to, "runtime"),
        projectId: project.id,
        fromServiceId: serviceId(edge.from),
        toServiceId: serviceId(edge.to),
        dependencyType: "RUNTIME",
        criticality: edge.criticality ?? "HIGH",
        isActive: true,
        updatedAt: now
      }
    });
    dependencyCount += 1;
  }

  return { projectId: project.id, serviceCount: services.length, dependencyCount };
};

export const nobleExpressServiceKeys = {
  redis: serviceId("redis"),
  pricingEngine: serviceId("pricing-engine"),
  quoteApi: serviceId("quote-api"),
  customerQuoteJourney: serviceId("customer-quote-journey"),
  quotesModule: serviceId("quotes"),
  nobleExpressApp: serviceId("noble-express"),
  trackingModule: serviceId("tracking")
};
