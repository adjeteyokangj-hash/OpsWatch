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
  type: "APP" | "MODULE";
  criticality: string;
  isCritical: boolean;
  createdAt: Date;
  updatedAt: Date;
  ownerTeam?: string | null;
  status?: string;
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
        findFirst: vi.fn(async ({ where, orderBy }: any) => {
          if (where?.type === "APP") {
            return services
              .filter((service) => service.projectId === where.projectId && service.type === "APP")
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
          }
          if (where?.type === "MODULE" && typeof where?.name === "string") {
            return services.find((service) =>
              service.projectId === where.projectId
              && service.type === "MODULE"
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
            status: data.status ?? "UNKNOWN"
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
});
