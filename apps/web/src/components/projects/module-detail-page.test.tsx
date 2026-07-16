import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1", serviceId: "svc-public-website" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() })
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  )
}));

vi.mock("../layout/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children)
}));

vi.mock("./project-workspace-nav", () => ({
  ProjectWorkspaceNav: () => React.createElement("nav", { "aria-label": "Project sections" }, "Nav")
}));

const mockApiFetch = vi.fn();
vi.mock("../../lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args)
}));

import { ModuleDetailPage } from "./module-detail-page";

describe("ModuleDetailPage", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/projects/proj-1") {
        return Promise.resolve({
          id: "proj-1",
          name: "Noble Express",
          environment: "production",
          clientName: "Noble",
          status: "HEALTHY",
          services: [
            {
              id: "svc-public-website",
              name: "Public Website",
              type: "MODULE",
              status: "HEALTHY",
              baseUrl: "https://www.noblexp.com",
              isCritical: true,
              criticality: "HIGH"
            }
          ],
          alerts: [
            {
              id: "alert-1",
              title: "Homepage latency high",
              severity: "HIGH",
              status: "OPEN",
              serviceId: "svc-public-website"
            }
          ]
        });
      }
      if (path.startsWith("/checks?")) {
        return Promise.resolve({
          items: [
            {
              id: "check-1",
              name: "Homepage HTTP",
              type: "HTTP",
              latestResult: { status: "PASS", checkedAt: "2026-07-16T12:00:00.000Z" }
            }
          ],
          summary: { total: 1, pass: 1, fail: 0, warn: 0, pending: 0 }
        });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("renders module overview with checks and open alerts", async () => {
    render(<ModuleDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("page-heading")).toHaveTextContent("Public Website");
    });

    expect(screen.getByText("https://www.noblexp.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /homepage latency high/i })).toHaveAttribute(
      "href",
      "/alerts/alert-1"
    );
    expect(screen.getByText("Homepage HTTP")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^view checks$/i })).toHaveAttribute(
      "href",
      "/checks?projectId=proj-1&serviceId=svc-public-website"
    );
    expect(screen.getByRole("link", { name: /view topology/i })).toHaveAttribute(
      "href",
      "/projects/proj-1/topology"
    );
    expect(screen.getByRole("button", { name: /edit module/i })).toBeInTheDocument();
  });

  it("shows honest empty checks state with Add check CTA", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/projects/proj-1") {
        return Promise.resolve({
          id: "proj-1",
          name: "Noble Express",
          environment: "production",
          clientName: "Noble",
          status: "UNKNOWN",
          services: [
            {
              id: "svc-public-website",
              name: "Public Website",
              type: "MODULE",
              status: "UNKNOWN",
              baseUrl: null,
              isCritical: false
            }
          ],
          alerts: []
        });
      }
      if (path.startsWith("/checks?")) {
        return Promise.resolve({ items: [], summary: { total: 0, pass: 0, fail: 0, warn: 0, pending: 0 } });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<ModuleDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/no checks for this module yet/i)).toBeInTheDocument();
    });

    const addCheck = screen.getByRole("link", { name: /^add check$/i });
    expect(addCheck).toHaveAttribute("href", "/checks?projectId=proj-1&serviceId=svc-public-website");
    expect(screen.getByText("No target URL")).toBeInTheDocument();
    expect(screen.getByText("No open alerts for this module.")).toBeInTheDocument();
  });
});
