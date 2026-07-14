import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopologyRefreshBanner } from "./topology-error-banner";
import { classifyTopologyError } from "./topology-error-classify";

describe("classifyTopologyError", () => {
  it("classifies Vercel FUNCTION_INVOCATION_TIMEOUT", () => {
    const classified = classifyTopologyError(
      new Error("FUNCTION_INVOCATION_TIMEOUT\nInvocation ID: 12345678-1234-1234-1234-123456789abc")
    );
    expect(classified.kind).toBe("timeout");
    expect(classified.title).toMatch(/delayed/i);
    expect(classified.explanation).toMatch(/timed out/i);
    expect(classified.invocationId).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("classifies unreachable API copy", () => {
    const classified = classifyTopologyError(
      new Error("API unreachable for /projects/x/topology. The OpsWatch API did not respond (timeout, outage, or proxy misconfiguration).")
    );
    expect(classified.kind).toBe("unavailable");
  });
});

describe("TopologyRefreshBanner", () => {
  afterEach(() => cleanup());

  it("shows friendly copy with expandable technical details", () => {
    const error = classifyTopologyError(new Error("FUNCTION_INVOCATION_TIMEOUT id 12345678-1234-1234-1234-123456789abc"));
    render(
      <TopologyRefreshBanner
        error={error}
        lastSuccessfulAt="2026-07-14T11:00:00.000Z"
        autoRetrying
      />
    );

    expect(screen.getByTestId("topology-refresh-banner")).toBeInTheDocument();
    expect(screen.getByText(/Topology refresh delayed/i)).toBeInTheDocument();
    expect(screen.getByText(/Retrying automatically/i)).toBeInTheDocument();
    expect(screen.queryByTestId("topology-refresh-banner-details")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("topology-refresh-banner-toggle"));
    expect(screen.getByTestId("topology-refresh-banner-details")).toHaveTextContent(/FUNCTION_INVOCATION_TIMEOUT/);
    expect(screen.getByTestId("topology-refresh-banner-details")).toHaveTextContent(/Invocation ID/);
  });
});
