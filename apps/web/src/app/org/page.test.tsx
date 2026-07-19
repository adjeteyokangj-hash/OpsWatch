import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OrgPage from "./page";
import { apiFetch } from "../../lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("../../components/layout/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children)
}));

vi.mock("../../components/layout/header", () => ({
  Header: ({ title }: { title: string }) => React.createElement("h1", null, title)
}));

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn()
}));

const sampleKeys = [
  {
    id: "key-active",
    name: "Active ingest",
    keyId: "ow_abc123def456",
    prefix: "ow_abc123de",
    scopes: ["events:write"],
    environment: "live" as const,
    project: { id: "proj-1", name: "Sparkle" },
    lastUsedAt: null,
    lastUsedRoute: "N/A",
    lastUsedIp: "N/A",
    lastUsedUserAgent: "N/A",
    expiresAt: "2026-12-31T00:00:00.000Z",
    graceExpiresAt: null,
    revokedAt: null,
    revokeReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    requests24h: 0,
    failedAttempts24h: 0,
    status: "ACTIVE" as const
  },
  {
    id: "key-expiring",
    name: "Expiring key",
    keyId: "ow_expiring123",
    prefix: "ow_expiring",
    scopes: ["heartbeats:write"],
    environment: "test" as const,
    project: null,
    lastUsedAt: "2026-07-01T12:00:00.000Z",
    lastUsedRoute: "N/A",
    lastUsedIp: "N/A",
    lastUsedUserAgent: "N/A",
    expiresAt: "2026-07-25T00:00:00.000Z",
    graceExpiresAt: null,
    revokedAt: null,
    revokeReason: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    requests24h: 0,
    failedAttempts24h: 0,
    status: "EXPIRING_SOON" as const
  },
  {
    id: "key-revoked",
    name: "Revoked key",
    keyId: "ow_revoked123",
    prefix: "ow_revoked1",
    scopes: ["events:write"],
    environment: "live" as const,
    project: null,
    lastUsedAt: null,
    lastUsedRoute: "N/A",
    lastUsedIp: "N/A",
    lastUsedUserAgent: "N/A",
    expiresAt: null,
    graceExpiresAt: null,
    revokedAt: "2026-06-01T00:00:00.000Z",
    revokeReason: "compromised",
    createdAt: "2026-01-15T00:00:00.000Z",
    requests24h: 0,
    failedAttempts24h: 0,
    status: "REVOKED" as const
  }
];

describe("OrgPage API keys", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders credential lifecycle status pills", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === "/org") {
        return {
          id: "org-1",
          name: "OpsWatch",
          slug: "opswatch",
          plan: "starter",
          isActive: true,
          _count: { users: 1, projects: 1 }
        } as never;
      }
      if (path === "/org/status-pages") return [] as never;
      if (path === "/projects") return [{ id: "proj-1", name: "Sparkle", slug: "sparkle" }] as never;
      if (path === "/org/api-keys") return sampleKeys as never;
      if (path === "/org/api-keys/usage") {
        return { last24hRequests: 0, failedAuthAttempts: 0, activeKeys: 1 } as never;
      }
      throw new Error(`Unexpected path ${path}`);
    });

    render(<OrgPage />);

    await screen.findByTestId("api-key-status-key-active");
    expect(screen.getByTestId("api-key-status-key-active")).toHaveTextContent("Active");
    expect(screen.getByTestId("api-key-status-key-expiring")).toHaveTextContent("Expiring soon");
    expect(screen.getByTestId("api-key-status-key-revoked")).toHaveTextContent("Revoked");
    expect(screen.getByTestId("api-key-prefix-key-active")).toHaveTextContent("ow_abc123de");
  });

  it("shows rotated key once and clears it after dismiss", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === "/org") {
        return {
          id: "org-1",
          name: "OpsWatch",
          slug: "opswatch",
          plan: "starter",
          isActive: true,
          _count: { users: 1, projects: 1 }
        } as never;
      }
      if (path === "/org/status-pages") return [] as never;
      if (path === "/projects") return [{ id: "proj-1", name: "Sparkle", slug: "sparkle" }] as never;
      if (path === "/org/api-keys" && options?.method !== "POST") return [sampleKeys[0]] as never;
      if (path === "/org/api-keys/usage") {
        return { last24hRequests: 0, failedAuthAttempts: 0, activeKeys: 1 } as never;
      }
      if (path === "/org/api-keys/key-active/rotate" && options?.method === "POST") {
        return {
          id: "key-rotated",
          keyId: "ow_newrotate",
          key: "ow_newrotate.super-secret-value",
          prefix: "ow_newrotate",
          name: "Active ingest",
          scopes: ["events:write"],
          environment: "live",
          project: { id: "proj-1", name: "Sparkle" },
          expiresAt: "2026-12-31T00:00:00.000Z",
          createdAt: "2026-07-19T10:00:00.000Z"
        } as never;
      }
      throw new Error(`Unexpected path ${path}`);
    });

    render(<OrgPage />);

    await screen.findByTestId("api-key-rotate-key-active");
    fireEvent.click(screen.getByTestId("api-key-rotate-key-active"));
    fireEvent.click(screen.getByTestId("confirm-api-key-rotate"));

    await waitFor(() => {
      expect(screen.getByTestId("rotated-api-key-value")).toHaveValue("ow_newrotate.super-secret-value");
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByTestId("rotated-api-key-value")).not.toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("ow_newrotate.super-secret-value")).not.toBeInTheDocument();
  });
});
