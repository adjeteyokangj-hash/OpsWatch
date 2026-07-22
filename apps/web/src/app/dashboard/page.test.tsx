import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { fetchSessionUser } from "../../lib/auth";
import DashboardPage from "./page";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../../lib/auth", () => ({ fetchSessionUser: vi.fn() }));

vi.mock("../../components/layout/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>
}));
vi.mock("../../components/layout/header", () => ({
  Header: ({ title }: { title: string }) => <h1>{title}</h1>
}));
vi.mock("../../components/dashboard/stat-card", () => ({
  StatCard: ({ label, value }: { label: string; value: string | number }) => (
    <div>{label}: {String(value)}</div>
  )
}));
vi.mock("../../components/dashboard/health-overview", () => ({
  HealthOverview: () => <div>Health overview</div>
}));
vi.mock("../../components/dashboard/recent-alerts", () => ({
  RecentAlerts: () => <div>Recent alerts</div>
}));
vi.mock("../../components/dashboard/recent-incidents", () => ({
  RecentIncidents: () => <div>Recent incidents</div>
}));
vi.mock("../../components/health/layer-health-table", () => ({
  LayerHealthTable: () => <div>Layer health</div>
}));
vi.mock("../../components/health/dashboard-app-status-table", () => ({
  DashboardAppStatusTable: ({ rows }: { rows: Array<{ name: string }> }) => (
    <div>Applications: {rows.map((row) => row.name).join(", ")}</div>
  )
}));
vi.mock("../../components/ui/page-section", () => ({
  PageSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section><h2>{title}</h2>{children}</section>
  )
}));
vi.mock("../../components/ui/empty-state", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>
}));
vi.mock("../../components/ui/learning-state-banner", () => ({
  LearningStateBanner: () => <div>Learning state</div>
}));
vi.mock("../../components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <span>{label}</span>
}));

const project = {
  id: "project-1",
  name: "Noble Express",
  environment: "production",
  status: "HEALTHY"
};

const coreResponse = (path: string): unknown => {
  if (path === "/projects") return [project];
  if (path === "/alerts") return [];
  if (path === "/incidents") return [];
  if (path === "/checks") {
    return {
      items: [],
      summary: { total: 0, pass: 0, fail: 0, warn: 0, pending: 0 }
    };
  }
  if (path === "/insights/product") return { projects: [] };
  if (path === "/analytics/layer-health") return [];
  return undefined;
};

describe("DashboardPage incremental loading", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders core monitoring data while Intelligence is still unresolved", async () => {
    const neverFinishes = new Promise<never>(() => undefined);
    vi.mocked(fetchSessionUser).mockResolvedValue({ organizationId: "org-1" } as never);
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/intelligence?harvest=false") return neverFinishes;
      return coreResponse(path) as never;
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Projects: 1")).toBeInTheDocument();
    });
    expect(screen.getByText("Applications: Noble Express")).toBeInTheDocument();
    expect(screen.queryByText("No monitoring data visible")).not.toBeInTheDocument();
  });

  it("keeps core monitoring data visible when a secondary endpoint fails", async () => {
    vi.mocked(fetchSessionUser).mockResolvedValue({ organizationId: "org-1" } as never);
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/intelligence?harvest=false") {
        throw new Error("intelligence query timed out");
      }
      return coreResponse(path) as never;
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Projects: 1")).toBeInTheDocument();
    });
    expect(screen.getByText(/intelligence query timed out/i)).toBeInTheDocument();
    expect(screen.queryByText("No monitoring data visible")).not.toBeInTheDocument();
  });
});
