import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  incidents: [] as Array<{
    id: string;
    projectId: string;
    status: string;
    IncidentAlert: Array<{ Alert: { status: string } }>;
  }>,
  timeline: [] as Array<Record<string, unknown>>
};

vi.mock("../lib/prisma", () => ({
  prisma: {
    incident: {
      findMany: vi.fn(async () => store.incidents),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.incidents.find((item) => item.id === where.id);
        if (!row) throw new Error("missing");
        Object.assign(row, data);
        return row;
      })
    },
    incidentTimelineEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.timeline.push(data);
        return data;
      })
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops))
  }
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { resolveIncidentsJob } from "./resolve-incidents.job";

describe("resolveIncidentsJob reconciliation", () => {
  beforeEach(() => {
    store.incidents = [];
    store.timeline = [];
    vi.clearAllMocks();
  });

  it("resolves open incidents when every linked alert is resolved", async () => {
    store.incidents.push({
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      IncidentAlert: [{ Alert: { status: "RESOLVED" } }, { Alert: { status: "RESOLVED" } }]
    });

    await resolveIncidentsJob();

    expect(store.incidents[0]!.status).toBe("RESOLVED");
    expect(store.timeline.some((row) => row.eventType === "INCIDENT_RESOLVED")).toBe(true);
  });

  it("keeps incidents open when any linked alert remains active", async () => {
    store.incidents.push({
      id: "inc-2",
      projectId: "proj-1",
      status: "INVESTIGATING",
      IncidentAlert: [{ Alert: { status: "RESOLVED" } }, { Alert: { status: "OPEN" } }]
    });

    await resolveIncidentsJob();

    expect(store.incidents[0]!.status).toBe("INVESTIGATING");
    expect(store.timeline).toHaveLength(0);
  });
});
