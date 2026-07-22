import { describe, expect, it } from "vitest";
import {
  serviceCardHealthLabel,
  usesInheritedApplicationHeartbeat
} from "./service-card-grid";

const moduleRow = (status: string, checks: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id: "module-1",
  type: "MODULE",
  status,
  Check: checks,
  ...extra
});

describe("module application-signal card labels", () => {
  it("identifies logical modules without dedicated checks", () => {
    expect(usesInheritedApplicationHeartbeat(moduleRow("UNKNOWN"))).toBe(true);
    expect(usesInheritedApplicationHeartbeat(moduleRow("HEALTHY", [{ id: "check-1" }]))).toBe(false);
    expect(usesInheritedApplicationHeartbeat({ type: "API", status: "HEALTHY", Check: [] })).toBe(false);
  });

  it("uses generic application-signal wording when no source label is supplied", () => {
    expect(serviceCardHealthLabel(moduleRow("UNKNOWN"))).toBe("Awaiting live signal");
    expect(serviceCardHealthLabel(moduleRow("HEALTHY"))).toBe("Application signal active");
    expect(serviceCardHealthLabel(moduleRow("DEGRADED"))).toBe("Application signal delayed");
    expect(serviceCardHealthLabel(moduleRow("DOWN"))).toBe("Application signal down");
    expect(serviceCardHealthLabel(moduleRow("PAUSED"))).toBe("Monitoring paused");
  });

  it("shows the authoritative connection or heartbeat label returned by the API", () => {
    expect(
      serviceCardHealthLabel(
        moduleRow("HEALTHY", [], {
          healthDisplayLabel: "Connection verified",
          healthSource: "CONNECTION_DISCOVERY"
        })
      )
    ).toBe("Connection verified");
    expect(
      serviceCardHealthLabel(
        moduleRow("HEALTHY", [], {
          healthDisplayLabel: "App heartbeat active",
          healthSource: "HEARTBEAT"
        })
      )
    ).toBe("App heartbeat active");
  });

  it("defers to dedicated monitoring when a module has checks", () => {
    expect(
      serviceCardHealthLabel(
        moduleRow("HEALTHY", [{ id: "check-1" }], {
          healthDisplayLabel: "Connection verified"
        })
      )
    ).toBeNull();
  });
});
