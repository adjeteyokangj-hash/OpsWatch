import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  transaction,
  projectFindFirst,
  connectionUpdate,
  auditCreate,
  backfillCanonicalTopology
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  projectFindFirst: vi.fn(),
  connectionUpdate: vi.fn(),
  auditCreate: vi.fn(),
  backfillCanonicalTopology: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    project: { findFirst: projectFindFirst },
    connection: { update: connectionUpdate },
    auditLog: { create: auditCreate }
  }
}));

vi.mock("../topology-unification.service", () => ({
  backfillCanonicalTopology
}));

import {
  reconcileConnectionTopologyManifest,
  type ConnectionTopologyManifest
} from "./connection-topology-discovery.service";

type MockService = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  criticality: string;
  isCritical: boolean;
  createdAt: Date;
  updatedAt: Date;
  ownerTeam?: string | null;
  status?: string;
  topologyMetaJson?: unknown;
};

type MockDependency = {
  id: string;
  projectId: string;
  fromServiceId: string;
  toServiceId: string;
  dependencyType: string;
  source: string;
  criticality: string;
  isActive: boolean;
  updatedAt: Date;
};

const connection = {
  id: "connection-1",
  organizationId: "org-1",
  projectId: "project-1",
  name: "StarLiz",
  mode: "API",
  environment: "production",
  authMethod: "BEARER",
  configurationJson: { endpoint: "https://www.starlizacademy.com/api/external/v1/health" },
  credentialFamilyId: null,
  secretRef: null,
  managedSecretCiphertext: null,
  managedSecretIv: null,
  managedSecretAuthTag: null
};

const manifest = (modules: ConnectionTopologyManifest["modules"]): ConnectionTopologyManifest => ({
  schemaVersion: "1.0",
  source: "starliz-academy",
  application: { key: "starliz-academy", name: "StarLiz Academy" },
  modules
});

describe("reconcileConnectionTopologyManifest", () => {
  let services: MockService[];
  let dependencies: MockDependency[];

  beforeEach(() => {
    services = [
      {
        id: "manual-student-portal",
        projectId: "project-1",
        name: "Student Portal",
        type: "MODULE",
        criticality: "MEDIUM",
        isCritical: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ];
    dependencies = [];
    vi.clearAllMocks();
    projectFindFirst.mockResolvedValue({
      id: "project-1",
      organizationId: "org-1",
      environment: "production",
      name: "StarLiz Academy"
    });
    connectionUpdate.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    backfillCanonicalTopology.mockResolvedValue({ entitiesMapped: 2, relationshipsMapped: 2 });
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      service: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (typeof where?.id === "string") {
            return services.find((service) => service.id === where.id) ?? null;
          }
          if (where?.type === "APP") {
            return services
              .filter((service) => service.projectId === where.projectId && service.type === "APP")
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
          }
          if (where?.type && typeof where?.name === "string") {
            return services.find((service) =>
              service.projectId === where.projectId
              && service.type === where.type
              && service.name === where.name
            ) ?? null;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }: any) =>
          services.filter((service) =>
            (!where?.projectId || service.projectId === where.projectId)
            && (!where?.type || service.type === where.type)
            && (!where?.id?.in || where.id.in.includes(service.id))
          )
        ),
        create: vi.fn(async ({ data }: any) => {
          const row: MockService = {
            id: data.id,
            projectId: data.projectId,
            name: data.name,
            type: data.type,
            criticality: data.criticality ?? "MEDIUM",
            isCritical: data.isCritical ?? false,
            createdAt: data.createdAt ?? new Date(),
            updatedAt: data.updatedAt ?? new Date(),
            ownerTeam: data.ownerTeam ?? null,
            status: data.status ?? "UNKNOWN",
            topologyMetaJson: data.topologyMetaJson ?? null
          };
          services.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = services.find((service) => service.id === where.id);
          if (!row) throw new Error(`Service ${where.id} not found`);
          Object.assign(row, data);
          return row;
        })
      },
      serviceDependency: {
        findMany: vi.fn(async ({ where }: any) =>
          dependencies.filter((dependency) =>
            dependency.projectId === where.projectId
            && dependency.dependencyType === where.dependencyType
            && dependency.source === where.source
            && dependency.toServiceId === where.toServiceId
          )
        ),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const key = where.fromServiceId_toServiceId_dependencyType;
          const existing = dependencies.find((dependency) =>
            dependency.fromServiceId === key.fromServiceId
            && dependency.toServiceId === key.toServiceId
            && dependency.dependencyType === key.dependencyType
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row: MockDependency = {
            id: create.id,
            projectId: create.projectId,
            fromServiceId: create.fromServiceId,
            toServiceId: create.toServiceId,
            dependencyType: create.dependencyType,
            source: create.source,
            criticality: create.criticality,
            isActive: create.isActive,
            updatedAt: create.updatedAt
          };
          dependencies.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = dependencies.find((dependency) => dependency.id === where.id);
          if (!row) throw new Error(`Dependency ${where.id} not found`);
          Object.assign(row, data);
          return row;
        })
      },
      connection: { update: connectionUpdate },
      auditLog: { create: auditCreate }
    }));
  });

  it("reuses the generic importer without duplicating modules and preserves manual matches", async () => {
    const studentAndPayments = manifest([
      { key: "student-portal", name: "Student Portal", category: "portal", description: "", criticality: "HIGH", routePrefixes: ["/student"] },
      { key: "payments", name: "Payments", category: "commerce", description: "", criticality: "HIGH", routePrefixes: ["/billing"] }
    ]);

    const first = await reconcileConnectionTopologyManifest(connection, studentAndPayments);
    const second = await reconcileConnectionTopologyManifest(connection, studentAndPayments);

    expect(first.moduleCount).toBe(2);
    expect(second.moduleCount).toBe(2);
    expect(services.filter((service) => service.type === "MODULE")).toHaveLength(2);
    expect(services.find((service) => service.name === "Student Portal")?.id).toBe("manual-student-portal");
    expect(dependencies.filter((dependency) => dependency.isActive)).toHaveLength(2);
  });

  it("marks removed discovered module links inactive while preserving the manual module", async () => {
    await reconcileConnectionTopologyManifest(connection, manifest([
      { key: "student-portal", name: "Student Portal", category: "portal", description: "", criticality: "HIGH", routePrefixes: ["/student"] },
      { key: "payments", name: "Payments", category: "commerce", description: "", criticality: "HIGH", routePrefixes: ["/billing"] }
    ]));

    await reconcileConnectionTopologyManifest(connection, manifest([
      { key: "student-portal", name: "Student Portal", category: "portal", description: "", criticality: "HIGH", routePrefixes: ["/student"] }
    ]));

    const paymentsService = services.find((service) => service.name === "Payments");
    expect(paymentsService).toBeTruthy();
    expect(
      dependencies.find((dependency) => dependency.fromServiceId === paymentsService?.id)?.isActive
    ).toBe(false);
    expect(services.find((service) => service.id === "manual-student-portal")).toBeTruthy();
  });

  it("imports a version 1.1 fixture that is not NiiNai and keeps configured links", async () => {
    const harbor = {
      schemaVersion: "1.1" as const,
      source: "harbor-ledger",
      application: { key: "harbor-ledger", name: "Harbor Ledger" },
      modules: [
        {
          key: "invoices",
          name: "Invoices",
          description: "Customer invoices",
          criticality: "HIGH" as const,
          routePrefixes: ["/invoices"]
        }
      ],
      components: [
        {
          key: "warehouse",
          name: "North Warehouse",
          kind: "property" as const,
          description: "",
          criticality: "MEDIUM" as const,
          routePrefixes: []
        },
        {
          key: "desk",
          name: "Counter desk",
          kind: "installation" as const,
          description: "",
          criticality: "MEDIUM" as const,
          routePrefixes: [],
          parentKey: "warehouse"
        },
        {
          key: "month-end",
          name: "Month end",
          kind: "workflow" as const,
          description: "",
          criticality: "HIGH" as const,
          routePrefixes: [],
          parentKey: "invoices"
        }
      ],
      relationships: [
        {
          from: "month-end",
          to: "invoices",
          type: "depends_on" as const,
          criticality: "HIGH" as const,
          provenance: "verified" as const
        },
        {
          from: "desk",
          to: "warehouse",
          type: "runs_on" as const,
          criticality: "MEDIUM" as const,
          provenance: "configured" as const
        }
      ],
      healthBindings: [
        { componentKey: "invoices", signal: "http_check" as const, checkName: "Ledger health" },
        { componentKey: "month-end", signal: "heartbeat_lane" as const, lane: "financial" as const },
        { componentKey: "warehouse", signal: "unbound" as const }
      ]
    };

    const result = await reconcileConnectionTopologyManifest(connection, harbor);

    expect(result.moduleCount).toBe(1);
    expect(result.componentCount).toBe(3);
    expect(services.map((service) => service.name)).toEqual(
      expect.arrayContaining(["Harbor Ledger", "Invoices", "North Warehouse", "Counter desk", "Month end"])
    );
    expect(services.find((service) => service.name === "Month end")?.type).toBe("WORKFLOW");
    expect(services.find((service) => service.name === "North Warehouse")?.type).toBe("MODULE");
    expect(services.find((service) => service.name === "Counter desk")?.type).toBe("COMPONENT");
    expect(dependencies.find((dependency) => dependency.dependencyType === "DEPENDS_ON")?.source).toBe(
      "CONNECTION_DISCOVERY"
    );
    expect(dependencies.find((dependency) => dependency.dependencyType === "RUNS_ON")?.source).toBe("MANUAL");
    const audit = auditCreate.mock.calls.at(-1)?.[0]?.data?.metadataJson;
    expect(audit.componentKinds).toMatchObject({
      warehouse: "property",
      desk: "installation",
      "month-end": "workflow"
    });
    expect(audit.healthBindings).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toMatch(/niinai|kanewu|guest/i);
  });

  it("imports the approved application manifest and keeps unbound modules grey when a sync lane fails", async () => {
    const { readFileSync } = await import("node:fs");
    const document = JSON.parse(
      readFileSync(new URL("./fixtures/niinai-topology-v11.json", import.meta.url), "utf8")
    );
    const result = await reconcileConnectionTopologyManifest(connection, document);

    expect(result.moduleCount).toBe(14);
    expect(result.componentCount).toBe(19);
    expect(result.relationshipCount).toBe(25);
    expect(services.filter((service) => service.type !== "APP" && service.id !== "manual-student-portal")).toHaveLength(33);

    const metaOf = (name: string) =>
      services.find((service) => service.name === name)?.topologyMetaJson as {
        declaredKind?: string;
        externalId?: string | null;
        healthBinding?: { signal?: string; lane?: string | null } | null;
      } | null;

    expect(metaOf("Kanewu")).toMatchObject({
      declaredKind: "property",
      externalId: "10000000-0000-4000-8000-000000000001"
    });
    expect(metaOf("Community 25")?.declaredKind).toBe("property");
    expect(metaOf("Community 25")?.externalId ?? null).toBeNull();
    expect(metaOf("Lifecycle synchronisation")?.healthBinding).toMatchObject({
      signal: "heartbeat_lane",
      lane: "lifecycle"
    });
    expect(metaOf("Payments")?.healthBinding?.signal).toBe("unbound");
    expect(metaOf("Supabase authentication")?.declaredKind).toBe("component");
    expect(dependencies.filter((dependency) => dependency.isActive && dependency.dependencyType === "DEPENDS_ON")).toHaveLength(18);
    expect(dependencies.filter((dependency) => dependency.isActive && dependency.dependencyType === "SYNCS")).toHaveLength(6);
    expect(dependencies.filter((dependency) => dependency.isActive && dependency.dependencyType === "RUNS_ON")).toHaveLength(1);

    const { buildProjectTopologyResponse } = await import("../topology.service");
    const { presentMonitoredDevices, DEVICE_OFFLINE_AFTER_SECONDS } = await import("../device-heartbeat");
    const { projectDeviceTelemetry } = await import("../topology-telemetry-projection");
    const { applyDeclaredHealth } = await import("../topology-health-bindings");

    const built = buildProjectTopologyResponse({
      project: { id: "project-1", name: "NiiNai", status: "UNKNOWN" },
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        type: service.type as "APP" | "MODULE" | "WORKFLOW" | "COMPONENT",
        status: service.status ?? "UNKNOWN",
        meta: service.topologyMetaJson as {
          declaredKind?: string | null;
          category?: string | null;
          externalId?: string | null;
          healthBinding?: { signal?: string | null; lane?: string | null; checkName?: string | null } | null;
        } | null,
        Check: []
      })),
      dependencies: dependencies.filter((dependency) => dependency.isActive),
      alerts: [],
      incidents: [],
      slos: []
    });

    const now = new Date("2026-10-18T09:00:00.000Z");
    const [matched, unmatched] = presentMonitoredDevices(
      [
        {
          id: "desk-1",
          deviceId: "11111111-1111-4111-8111-111111111111",
          label: "Front desk",
          propertyId: "10000000-0000-4000-8000-000000000001",
          appVersion: "1.3.2",
          lifecycleSync: "HEALTHY",
          financialSync: "FAILED",
          lastSeenAt: now,
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        },
        {
          id: "desk-2",
          deviceId: "22222222-2222-4222-8222-222222222222",
          label: "Unassigned desk",
          propertyId: "33333333-3333-4333-8333-333333333333",
          appVersion: "1.3.2",
          lifecycleSync: "DELAYED",
          financialSync: "HEALTHY",
          lastSeenAt: now,
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        }
      ],
      now
    );
    const placed = projectDeviceTelemetry(built, [matched!, unmatched!]);
    const painted = applyDeclaredHealth(placed, [matched!, unmatched!]);
    const byName = new Map(painted.nodes.map((node) => [node.name, node]));
    const appId = byName.get("NiiNai")?.id;

    expect(byName.get("Front desk")?.parentId).toBe(byName.get("Kanewu")?.id);
    expect(byName.get("Front desk")?.status).toBe("HEALTHY");
    expect(byName.get("Unassigned desk")?.parentId).toBe(appId);
    expect(byName.get("Unassigned desk")?.parentId).not.toBe(byName.get("Community 25")?.id);
    expect(byName.get("Financial synchronisation")?.status).toBe("CRITICAL");
    expect(byName.get("Lifecycle synchronisation")?.status).toBe("DEGRADED");
    for (const name of ["Payments", "Refund processing", "End of Day", "Cash reconciliation", "Room synchronisation", "Supabase authentication"]) {
      expect(byName.get(name)?.status).toBe("UNKNOWN");
    }
    expect(painted.nodeContext[byName.get("Payments")!.id]?.manifest?.potentialImpact.map((item) => item.name)).toContain(
      "Financial synchronisation"
    );
    expect(painted.summary.openIncidents).toBe(0);
  });
});
