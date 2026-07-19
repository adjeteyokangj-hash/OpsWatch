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
      heartbeat: "NOT_CONFIGURED" as const,
      events: "NOT_CONFIGURED" as const
    },
    advancedMonitoring: {
      logs: "NOT_CONNECTED" as const,
      traces: "NOT_CONNECTED" as const,
      infrastructure: "NOT_CONNECTED" as const
    }
  }
};

const registerApp = async (name: string) => {
  render(
    <RegisterApplicationWizard
      onClose={() => undefined}
      onCreated={() => undefined}
    />
  );

  await screen.findByText("Test Org");
  fireEvent.change(screen.getByLabelText("Application name *"), {
    target: { value: name }
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

    await registerApp("Phase 1 Test App");

    await screen.findByText("Setting up external monitoring…");
    expect(screen.getByText("Website connection created")).toBeInTheDocument();
    expect(screen.getByText("HTTP check scheduled")).toBeInTheDocument();
    expect(screen.getByText("SSL check scheduled")).toBeInTheDocument();
    expect(screen.getByText("Application · Heartbeat")).toBeInTheDocument();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);

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

  it("shows signing secret configured hint when reused credentials omit plaintext", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === "/org") return { id: "org-1", name: "Test Org", slug: "test-org" } as never;
      if (path === "/projects" && options?.method === "POST") {
        return {
          id: "project-2",
          name: "Reused Secret App",
          slug: "reused-secret-app",
          environment: "testing",
          status: "UNKNOWN",
          monitoringSetup: activeMonitoring,
          ingestCredentials: {
            apiKey: "shown-once",
            signingSecret: "",
            signingSecretConfigured: true,
            reused: true,
            projectSlug: "reused-secret-app"
          }
        } as never;
      }
      if (path === "/projects/project-2") {
        return {
          id: "project-2",
          name: "Reused Secret App",
          slug: "reused-secret-app",
          status: "UNKNOWN",
          heartbeats: [],
          monitoringSetup: activeMonitoring
        } as never;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    await registerApp("Reused Secret App");
    await screen.findByText("Setting up external monitoring…");
    fireEvent.click(screen.getByRole("button", { name: "Continue →" }));

    expect(screen.getByTestId("signing-secret-configured")).toHaveTextContent("Signing secret already configured");
    expect(screen.queryByLabelText("Signing secret")).not.toBeInTheDocument();
  });
});
