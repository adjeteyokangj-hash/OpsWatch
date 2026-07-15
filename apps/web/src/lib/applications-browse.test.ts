import { describe, expect, it } from "vitest";
import {
  defaultViewForCount,
  isTestApplication,
  matchesApplicationSearch,
  pageSizeForView,
  paginateRows,
  sortApplicationsForBrowse
} from "./applications-browse";

describe("applications-browse", () => {
  it("detects Playwright and smoke fixtures as test applications", () => {
    expect(isTestApplication({ id: "1", name: "PW Connect Demo", slug: "pw-connect-demo" })).toBe(true);
    expect(isTestApplication({ id: "2", name: "Smoke Isolation App B", environment: "production" })).toBe(true);
    expect(
      isTestApplication({ id: "3", name: "Fixture", clientName: "Isolation Fixture", slug: "fixture" })
    ).toBe(true);
    expect(
      isTestApplication({ id: "5", name: "Connect Journey Demo", clientName: "Local Connect Journey", slug: "connect-journey" })
    ).toBe(true);
    expect(isTestApplication({ id: "4", name: "Noble Express", clientName: "Noble Express", environment: "production" })).toBe(
      false
    );
  });

  it("matches company, application, ids and connection ids case-insensitively", () => {
    const row = {
      id: "proj-abc",
      name: "TrueNumeris",
      slug: "truenumeris-prod",
      clientName: "OkangGroup",
      projectOwner: "Finance",
      environment: "production",
      connections: [{ id: "conn-99", name: "TrueNumeris API" }]
    };
    expect(matchesApplicationSearch(row, "  truenumeris ")).toBe(true);
    expect(matchesApplicationSearch(row, "OKANG")).toBe(true);
    expect(matchesApplicationSearch(row, "proj-abc")).toBe(true);
    expect(matchesApplicationSearch(row, "conn-99")).toBe(true);
    expect(matchesApplicationSearch(row, "missing")).toBe(false);
  });

  it("defaults to table view when more than 12 applications", () => {
    expect(defaultViewForCount(12)).toBe("cards");
    expect(defaultViewForCount(13)).toBe("table");
    expect(pageSizeForView("cards")).toBe(12);
    expect(pageSizeForView("table")).toBe(25);
  });

  it("paginates and sorts production applications ahead of test fixtures", () => {
    const rows = [
      { id: "t1", name: "PW Connect", slug: "pw-connect" },
      { id: "p1", name: "Noble Express", slug: "noble-express", environment: "production" },
      { id: "p2", name: "GlowLive Engine", slug: "glowlive", environment: "production" }
    ];
    const sorted = sortApplicationsForBrowse(rows);
    expect(sorted.map((row) => row.id)).toEqual(["p2", "p1", "t1"]);

    const page = paginateRows(sorted, 1, 2);
    expect(page.start).toBe(1);
    expect(page.end).toBe(2);
    expect(page.total).toBe(3);
    expect(page.slice.map((row) => row.id)).toEqual(["p2", "p1"]);
  });
});
