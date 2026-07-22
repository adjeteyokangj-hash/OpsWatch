import { describe, expect, it } from "vitest";
import {
  serviceCardHealthLabel,
  usesInheritedApplicationHeartbeat
} from "./service-card-grid";

const moduleRow = (status: string, checks: unknown[] = []) => ({
  id: "module-1",
  type: "MODULE",
  status,
  Check: checks
});

describe("module heartbeat card labels", () => {
  it("identifies logical modules without dedicated checks", () => {
    expect(usesInheritedApplicationHeartbeat(moduleRow("UNKNOWN"))).toBe(true);
    expect(usesInheritedApplicationHeartbeat(moduleRow("HEALTHY", [{ id: "check-1" }]))).toBe(false);
    expect(usesInheritedApplicationHeartbeat({ type: "API", status: "HEALTHY", Check: [] })).toBe(false);
  });

  it("shows application-heartbeat wording instead of claiming a module heartbeat", () => {
    expect(serviceCardHealthLabel(moduleRow("UNKNOWN"))).toBe("Awaiting app heartbeat");
    expect(serviceCardHealthLabel(moduleRow("HEALTHY"))).toBe("App heartbeat active");
    expect(serviceCardHealthLabel(moduleRow("DEGRADED"))).toBe("App heartbeat delayed");
    expect(serviceCardHealthLabel(moduleRow("DOWN"))).toBe("App heartbeat down");
    expect(serviceCardHealthLabel(moduleRow("PAUSED"))).toBe("Monitoring paused");
  });

  it("defers to dedicated monitoring when a module has checks", () => {
    expect(serviceCardHealthLabel(moduleRow("HEALTHY", [{ id: "check-1" }]))).toBeNull();
  });
});
