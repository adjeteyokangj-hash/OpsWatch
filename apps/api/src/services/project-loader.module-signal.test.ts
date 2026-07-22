import { describe, expect, it } from "vitest";
import { resolveInheritedModuleSignal } from "./project-loader.service";

const now = new Date("2026-07-22T13:30:00.000Z");

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: "connection-1",
  name: "TrueNumeris",
  mode: "API",
  health: "HEALTHY",
  healthReason: null,
  installationStatus: "CONNECTED",
  lastSuccessAt: null,
  lastSyncAt: new Date("2026-07-22T13:05:00.000Z"),
  lastSyncStatus: "SUCCEEDED",
  syncIntervalMinutes: 15,
  updatedAt: new Date("2026-07-22T13:05:00.000Z"),
  ...overrides
});

describe("resolveInheritedModuleSignal", () => {
  it("prefers a fresh real heartbeat", () => {
    const signal = resolveInheritedModuleSignal(
      {
        Heartbeat: [
          {
            receivedAt: new Date("2026-07-22T13:29:00.000Z"),
            status: "HEALTHY",
            message: "TrueNumeris heartbeat"
          }
        ],
        Connection: [connection()]
      } as any,
      now
    );

    expect(signal).toMatchObject({
      status: "HEALTHY",
      displayLabel: "App heartbeat active",
      source: "HEARTBEAT"
    });
  });

  it("uses a successful authenticated connection when no push heartbeat exists", () => {
    const signal = resolveInheritedModuleSignal(
      { Heartbeat: [], Connection: [connection()] } as any,
      now
    );

    expect(signal).toMatchObject({
      status: "HEALTHY",
      displayLabel: "Connection verified",
      source: "CONNECTION_DISCOVERY"
    });
  });

  it("marks an old successful connection as overdue instead of awaiting a heartbeat", () => {
    const signal = resolveInheritedModuleSignal(
      {
        Heartbeat: [],
        Connection: [
          connection({
            lastSyncAt: new Date("2026-07-22T12:00:00.000Z"),
            updatedAt: new Date("2026-07-22T12:00:00.000Z")
          })
        ]
      } as any,
      now
    );

    expect(signal).toMatchObject({
      status: "DEGRADED",
      displayLabel: "Connection check overdue",
      source: "CONNECTION_DISCOVERY"
    });
  });

  it("surfaces a failed connection as degraded", () => {
    const signal = resolveInheritedModuleSignal(
      {
        Heartbeat: [],
        Connection: [
          connection({
            health: "DEGRADED",
            healthReason: "Discovery endpoint timed out",
            lastSyncStatus: "FAILED"
          })
        ]
      } as any,
      now
    );

    expect(signal).toMatchObject({
      status: "DEGRADED",
      displayLabel: "Connection needs attention",
      reason: "Discovery endpoint timed out"
    });
  });

  it("returns no inherited signal when neither path has evidence", () => {
    expect(
      resolveInheritedModuleSignal({ Heartbeat: [], Connection: [] } as any, now)
    ).toBeNull();
  });
});
