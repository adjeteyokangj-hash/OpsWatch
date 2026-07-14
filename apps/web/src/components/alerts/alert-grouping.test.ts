import { describe, expect, it } from "vitest";
import { groupAlertsBySignature, type AlertListRow } from "./alert-grouping";

const base = (overrides: Partial<AlertListRow>): AlertListRow => ({
  id: "a1",
  title: "HTTP check failed",
  message: "timeout",
  severity: "HIGH",
  status: "OPEN",
  category: "AVAILABILITY",
  sourceType: "CHECK",
  firstSeenAt: "2026-07-14T10:00:00.000Z",
  lastSeenAt: "2026-07-14T10:00:00.000Z",
  project: { id: "p1", name: "App" },
  service: { id: "s1", name: "API" },
  linkedIncidents: [],
  ...overrides
});

describe("groupAlertsBySignature", () => {
  it("groups exact title+source+service matches and tracks first/last seen", () => {
    const groups = groupAlertsBySignature([
      base({ id: "1", firstSeenAt: "2026-07-14T10:00:00.000Z", lastSeenAt: "2026-07-14T10:00:00.000Z" }),
      base({
        id: "2",
        firstSeenAt: "2026-07-14T09:00:00.000Z",
        lastSeenAt: "2026-07-14T11:00:00.000Z",
        severity: "CRITICAL",
        linkedIncidents: [{ id: "i1", title: "Outage", status: "OPEN" }]
      }),
      base({ id: "3", title: "Different", service: { id: "s2", name: "Web" } })
    ]);

    expect(groups).toHaveLength(2);
    const primary = groups.find((row) => row.title === "HTTP check failed")!;
    expect(primary.count).toBe(2);
    expect(primary.firstSeenAt).toBe("2026-07-14T09:00:00.000Z");
    expect(primary.lastSeenAt).toBe("2026-07-14T11:00:00.000Z");
    expect(primary.linkedIncident?.id).toBe("i1");
  });
});
