import { describe, expect, it } from "vitest";
import { groupCorrelatedAlerts } from "./run-incident-correlation.job";

const alert = (id: string, projectId: string, serviceId: string) => ({ id, projectId, serviceId, severity: "HIGH" as const, title: id, firstSeenAt: new Date() });
describe("alert correlation grouping", () => {
  it("groups alerts from the same failing component", () => expect(groupCorrelatedAlerts([alert("a", "p", "s"), alert("b", "p", "s")], [])).toHaveLength(1));
  it("groups dependency-connected upstream and downstream services", () => expect(groupCorrelatedAlerts([alert("a", "p", "up"), alert("b", "p", "down")], [{ fromServiceId: "down", toServiceId: "up" }])).toHaveLength(1));
  it("does not merge unrelated alerts", () => expect(groupCorrelatedAlerts([alert("a", "p", "one"), alert("b", "p", "two")], [])).toHaveLength(2));
  it("does not merge alerts across projects or tenants", () => expect(groupCorrelatedAlerts([alert("a", "p1", "s"), alert("b", "p2", "s")], [])).toHaveLength(2));
  it("uses transitive dependency evidence", () => expect(groupCorrelatedAlerts([alert("a", "p", "a"), alert("c", "p", "c")], [{ fromServiceId: "a", toServiceId: "b" }, { fromServiceId: "b", toServiceId: "c" }])).toHaveLength(1));
});
