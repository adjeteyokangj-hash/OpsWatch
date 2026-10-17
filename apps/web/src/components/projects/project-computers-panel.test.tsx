import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectComputersPanel } from "./project-computers-panel";

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn()
}));

describe("ProjectComputersPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps each computer status independent when one is offline", () => {
    render(
      <ProjectComputersPanel
        projectId="project-1"
        persistKey="test-computers"
        cloud={{ status: "HEALTHY", label: "Healthy" }}
        devices={[
          {
            deviceId: "11111111-1111-4111-8111-111111111111",
            displayName: "Kanewu Reception",
            presence: "ONLINE",
            lifecycleSync: "FAILED",
            financialSync: "HEALTHY",
            appVersion: "1.3.2",
            lastSeenAt: "2026-10-17T12:00:00.000Z"
          },
          {
            deviceId: "22222222-2222-4222-8222-222222222222",
            displayName: "Community 25 Reception",
            presence: "OFFLINE",
            lifecycleSync: "HEALTHY",
            financialSync: "HEALTHY",
            appVersion: "1.3.1",
            lastSeenAt: "2026-10-17T11:40:00.000Z"
          },
          {
            deviceId: "33333333-3333-4333-8333-333333333333",
            displayName: "Owner computer",
            presence: "ONLINE",
            lifecycleSync: "HEALTHY",
            financialSync: "DELAYED",
            appVersion: "1.3.2",
            versionNote: "Different from another computer",
            lastSeenAt: "2026-10-17T11:59:00.000Z"
          }
        ]}
      />
    );

    const kanewu = screen.getByTestId("computer-11111111-1111-4111-8111-111111111111");
    const community = screen.getByTestId("computer-22222222-2222-4222-8222-222222222222");
    const owner = screen.getByTestId("computer-33333333-3333-4333-8333-333333333333");

    expect(within(kanewu).getByText("Online")).toBeTruthy();
    expect(within(kanewu).getByText("Failed")).toBeTruthy();
    expect(within(community).getByText("Offline")).toBeTruthy();
    expect(within(community).queryByText("Failed")).toBeNull();
    expect(within(owner).getByText("Online")).toBeTruthy();
    expect(within(owner).getByText("Delayed")).toBeTruthy();
    expect(screen.getByText(/does not open an incident/i)).toBeTruthy();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
  });
});
