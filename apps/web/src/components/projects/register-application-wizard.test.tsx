import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { RegisterApplicationWizard } from "./register-application-wizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn()
}));

const activeMonitoring = {
  status: "SETTING_UP" as const,
  error: null,
  steps: {
    websiteConnectionCreated: true,
    httpCheckScheduled: true,
    sslCheckScheduled: true,
    firstCheckPending: true,
    monitoringActive: false
  },
  depth: {
    externalMonitoring: {
      publicUrlConnected: true,
      httpMonitoringActive: false,
      sslMonitoringActive: false,
      adminUrlMonitoring: "PENDING" as const
    },
    applicationMonitoring: {
      heartbeat: "AWAITING_SETUP" as const,
      events: "NOT_CONFIGURED" as const
    },
    advancedMonitoring: {
      logs: "NOT_CONNECTED" as const,
      traces: "NOT_CONNECTED" as const,
      infrastructure: "NOT_CONNECTED" as const
    }
  }
};

describe("RegisterApplicationWizard URL-only onboarding", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submits public and admin URLs and shows setup independently of heartbeat", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === "/org") return { id: "org-1", name: "Test Org", slug: "test-org" } as never;
      if (path === "/projects" && options?.method === "POST") {
        return {
          id: "project-1",
          name: "Phase 1 Test App",
          slug: "phase-1-test-app",
          environment: "testing",
          status: "UNKNOWN",
          monitoringSetup: activeMonitoring,
          ingestCredentials: {
            apiKey: "shown-once",
            signingSecret: "shown-once-secret",
            projectSlug: "phase-1-test-app"
          }
        } as never;
      }
      if (path === "/projects/project-1") {
        return {
          id: "project-1",
          name: "Phase 1 Test App",
          slug: "phase-1-test-app",
          status: "UNKNOWN",
          heartbeats: [],
          monitoringSetup: activeMonitoring
        } as never;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RegisterApplicationWizard
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    );

    await screen.findByText("Test Org");
    fireEvent.change(screen.getByLabelText("Application name *"), {
      target: { value: "Phase 1 Test App" }
    });
    fireEvent.change(screen.getByLabelText("Environment *"), {
      target: { value: "testing" }
    });
    fireEvent.change(screen.getByLabelText(/Public application URL \(optional\)/), {
      target: { value: "https://www.example.com" }
    });
    fireEvent.change(screen.getByLabelText(/Admin URL \(optional\)/), {
      target: { value: "https://admin.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Register application" }));

    await screen.findByText("Setting up external monitoring…");
    expect(screen.getByText("Website connection created")).toBeInTheDocument();
    expect(screen.getByText("HTTP check scheduled")).toBeInTheDocument();
    expect(screen.getByText("SSL check scheduled")).toBeInTheDocument();
    expect(screen.getByText("Awaiting setup")).toBeInTheDocument();

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"adminUrl\":\"https://admin.example.com\"")
        })
      );
    });
  });
});
