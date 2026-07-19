import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionRegistry } from "./connection-registry";
import type { ConnectionRecord } from "./types";

const baseConnection = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  id: "conn-1",
  name: "Acme Production",
  type: "REST",
  mode: "API",
  environment: "production",
  authMethod: "BEARER",
  health: "HEALTHY",
  project: { id: "app-1", name: "Acme" },
  secretConfigured: true,
  lastError: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastValidatedAt: "2026-07-18T10:00:00.000Z",
  lastSuccessAt: "2026-07-18T09:00:00.000Z",
  ...overrides
});

describe("ConnectionRegistry credential metadata", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows masked configured status and lifecycle pills", () => {
    render(
      <ConnectionRegistry
        connections={[baseConnection(), baseConnection({ id: "conn-2", secretConfigured: false, authMethod: "BEARER" })]}
        loading={false}
        busyId={null}
        isAdmin={true}
        onAdd={() => undefined}
        onTest={() => undefined}
        onEdit={() => undefined}
        onDisable={() => undefined}
        onRotate={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(screen.getByTestId("connection-credential-mask-conn-1")).toHaveTextContent("Configured");
    expect(screen.getByTestId("connection-credential-mask-conn-2")).toHaveTextContent("Not configured");
    expect(screen.getByTestId("connection-credential-status-conn-2")).toHaveTextContent("Not configured");
    expect(screen.getByTestId("connection-credential-status-conn-1")).toHaveTextContent("Active");
  });

  it("hides rotate for non-admin when role is known", () => {
    render(
      <ConnectionRegistry
        connections={[baseConnection()]}
        loading={false}
        busyId={null}
        isAdmin={false}
        onAdd={() => undefined}
        onTest={() => undefined}
        onEdit={() => undefined}
        onDisable={() => undefined}
        onRotate={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(screen.queryByTestId("connection-rotate-button-conn-1")).not.toBeInTheDocument();
  });
});
