import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionWizard } from "./connection-wizard";
import {
  applyTrueNumerisPrefill,
  buildGuidedConnectionPayload,
  timeoutSecondsToMs
} from "./connection-form-state";
import { emptyGuidedForm, TRUE_NUMERIS_PROFILE } from "./types";
import { apiFetch } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn()
}));

const projects = [
  { id: "app-1", name: "Acme Storefront" },
  { id: "app-tn", name: "TrueNumeris" }
];

describe("connection-form-state", () => {
  it("converts timeout seconds to integer milliseconds including 30000", () => {
    expect(timeoutSecondsToMs(5)).toBe(5000);
    expect(timeoutSecondsToMs(10)).toBe(10000);
    expect(timeoutSecondsToMs(15)).toBe(15000);
    expect(timeoutSecondsToMs(30)).toBe(30000);
  });

  it("builds a guided payload with timeoutMs 30000 as a number", () => {
    const form = {
      ...emptyGuidedForm("app-1"),
      name: "Acme Production",
      method: "REST_API" as const,
      baseUrl: "https://api.example.com",
      healthPath: "/health",
      authType: "BEARER" as const,
      authSecret: "secret-value",
      authPrefix: "Bearer",
      timeoutSeconds: 30 as const
    };
    const payload = buildGuidedConnectionPayload(form);
    expect(payload.timeoutMs).toBe(30000);
    expect(typeof payload.timeoutMs).toBe("number");
    expect(payload.authSecret).toBe("secret-value");
    expect(payload.authHeaderName).toBe("Authorization");
    expect(payload.authPrefix).toBe("Bearer");
  });

  it("applies the verified TrueNumeris profile exactly", () => {
    const next = applyTrueNumerisPrefill(emptyGuidedForm("app-tn"));
    expect(next.name).toBe(TRUE_NUMERIS_PROFILE.name);
    expect(next.environment).toBe("production");
    expect(next.method).toBe("REST_API");
    expect(next.baseUrl).toBe("https://api.truenumeris.com");
    expect(next.healthPath).toBe("/api/v1/health");
    expect(next.authType).toBe("BEARER");
    expect(next.authHeaderName).toBe("Authorization");
    expect(next.authPrefix).toBe("Bearer");
    expect(next.discoveryPath).toBe("/api/v1/integrations/ping");
  });
});

describe("ConnectionWizard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows REST fields on configuration and keeps advanced details collapsed", async () => {
    render(
      <ConnectionWizard
        projects={projects}
        initialApplicationId="app-1"
        onCancel={() => undefined}
        onSaved={async () => undefined}
      />
    );

    expect(screen.getByTestId("connection-step-details")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByTestId("connection-step-configuration")).toBeInTheDocument();
    expect(screen.getByTestId("connection-base-url")).toBeInTheDocument();
    expect(screen.getByTestId("connection-health-path")).toBeInTheDocument();
    expect(screen.getByTestId("connection-auth-type")).toBeInTheDocument();
    expect(screen.getByTestId("connection-timeout")).toBeInTheDocument();

    const advanced = screen.getByTestId("connection-advanced");
    expect(advanced).not.toHaveAttribute("open");
    expect(within(advanced).queryByTestId("connection-advanced-mode")).toBeInTheDocument();
  });

  it("shows auth-specific fields for API key and Bearer", () => {
    render(
      <ConnectionWizard
        projects={projects}
        initialApplicationId="app-1"
        onCancel={() => undefined}
        onSaved={async () => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.change(screen.getByTestId("connection-auth-type"), { target: { value: "API_KEY" } });
    expect(screen.getByTestId("connection-auth-secret-field")).toBeInTheDocument();
    expect(screen.getByTestId("connection-header-name-field")).toBeInTheDocument();
    expect(screen.getByTestId("connection-auth-prefix-field")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("connection-auth-type"), { target: { value: "BEARER" } });
    expect(screen.getByTestId("connection-auth-secret-field")).toBeInTheDocument();
    expect(screen.queryByTestId("connection-header-name-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-auth-prefix-field")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("connection-auth-type"), { target: { value: "NONE" } });
    expect(screen.queryByTestId("connection-auth-secret-field")).not.toBeInTheDocument();
  });

  it("prefills verified TrueNumeris values when that application is selected", () => {
    render(
      <ConnectionWizard projects={projects} onCancel={() => undefined} onSaved={async () => undefined} />
    );

    fireEvent.change(screen.getByTestId("connection-application"), { target: { value: "app-tn" } });
    expect(screen.getByTestId("connection-name")).toHaveValue("TrueNumeris Production");
    expect(screen.getByTestId("connection-environment")).toHaveValue("production");
    expect(screen.getByTestId("connection-method")).toHaveValue("REST_API");

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByTestId("connection-base-url")).toHaveValue("https://api.truenumeris.com");
    expect(screen.getByTestId("connection-health-path")).toHaveValue("/api/v1/health");
    expect(screen.getByTestId("connection-auth-type")).toHaveValue("BEARER");
    expect(screen.getByTestId("connection-auth-prefix")).toHaveValue("Bearer");
    expect(screen.getByTestId("connection-discovery-path")).toHaveValue("/api/v1/integrations/ping");
  });

  it("enables Save and start monitoring only after a successful real test and clears authSecret after save", async () => {
    const onSaved = vi.fn(async () => undefined);
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        succeeded: true,
        statusCode: 200,
        responseTimeMs: 42,
        authenticationPassed: true,
        healthPassed: true,
        discoveryPassed: true,
        discoveredServices: ["billing-api"],
        validatedAt: "2026-07-19T05:00:00.000Z"
      })
      .mockResolvedValueOnce({ id: "conn-1" })
      .mockResolvedValueOnce({
        succeeded: true,
        statusCode: 200,
        responseTimeMs: 40,
        authenticationPassed: true,
        healthPassed: true,
        discoveryPassed: true,
        discoveredServices: ["billing-api"],
        validatedAt: "2026-07-19T05:00:01.000Z"
      });

    render(
      <ConnectionWizard
        projects={projects}
        initialForm={{
          ...emptyGuidedForm("app-tn"),
          ...TRUE_NUMERIS_PROFILE,
          applicationId: "app-tn",
          authSecret: "tn-live-key",
          timeoutSeconds: 30,
          nameManuallyEdited: true
        }}
        onCancel={() => undefined}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByTestId("connection-timeout"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const monitorButton = screen.getByTestId("connection-save-monitor-button");
    expect(monitorButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("connection-test-button"));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/connections/test",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timeoutMs":30000')
        })
      );
    });

    const testBody = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(testBody.timeoutMs).toBe(30000);
    expect(testBody.authSecret).toBe("tn-live-key");
    expect(testBody.authPrefix).toBe("Bearer");
    expect(testBody.baseUrl).toBe("https://api.truenumeris.com");

    await waitFor(() => {
      expect(screen.getByTestId("connection-test-result")).toBeInTheDocument();
      expect(monitorButton).not.toBeDisabled();
    });

    fireEvent.click(monitorButton);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/connections",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"startMonitoring":false')
      })
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      3,
      "/connections/conn-1/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ startMonitoring: true })
      })
    );

    const createBody = JSON.parse(String(vi.mocked(apiFetch).mock.calls[1][1]?.body));
    expect(createBody.authSecret).toBe("tn-live-key");

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("connection-auth-secret")).toHaveValue("");
    });
  });

  it("clears authSecret from form state after draft save", async () => {
    const onSaved = vi.fn(async () => undefined);
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: "conn-draft" });

    render(
      <ConnectionWizard
        projects={projects}
        initialForm={{
          ...emptyGuidedForm("app-1"),
          name: "Acme Production",
          applicationId: "app-1",
          baseUrl: "https://api.example.com",
          healthPath: "/health",
          authType: "BEARER",
          authSecret: "temporary-secret",
          authPrefix: "Bearer",
          nameManuallyEdited: true
        }}
        onCancel={() => undefined}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByTestId("connection-auth-secret")).toHaveValue("temporary-secret");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByTestId("connection-save-draft-button"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const createBody = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(createBody.authSecret).toBe("temporary-secret");

    // Stay on step 3 after save (page normally unmounts); navigate back to confirm React state cleared the secret.
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("connection-auth-secret")).toHaveValue("");
    });
  });

  it("never enables monitor-save on a failed test result", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      succeeded: false,
      statusCode: 401,
      responseTimeMs: 12,
      authenticationPassed: false,
      healthPassed: false,
      error: "Endpoint returned HTTP 401",
      errorCategory: "AUTHENTICATION_FAILED"
    });

    render(
      <ConnectionWizard
        projects={projects}
        initialForm={{
          ...emptyGuidedForm("app-1"),
          name: "Acme Production",
          applicationId: "app-1",
          baseUrl: "https://api.example.com",
          healthPath: "/health",
          authType: "BEARER",
          authSecret: "bad-key",
          nameManuallyEdited: true
        }}
        onCancel={() => undefined}
        onSaved={async () => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByTestId("connection-test-button"));

    await waitFor(() => {
      expect(screen.getByTestId("connection-test-result")).toBeInTheDocument();
    });

    expect(screen.getByTestId("connection-save-monitor-button")).toBeDisabled();
    expect(within(screen.getByTestId("connection-test-result")).getByText(/test failed/i)).toBeInTheDocument();
  });
});
