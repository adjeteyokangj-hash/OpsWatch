import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { useProjectWorkspace } from "../../hooks/use-project-workspace";
import { ProjectLayerPage } from "./project-layer-page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "project-1" })
}));
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../../hooks/use-project-workspace", () => ({ useProjectWorkspace: vi.fn() }));
vi.mock("./add-service-form", () => ({ AddServiceForm: () => <button>Add service</button> }));
vi.mock("./project-workspace-shell", () => ({
  ProjectWorkspaceShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <main>{actions}{children}</main>
  )
}));
vi.mock("./workspace-summary-strip", () => ({ WorkspaceSummaryStrip: () => <div>Summary</div> }));
vi.mock("./service-card-grid", () => ({ ServiceCardGrid: () => <div>Service cards</div> }));
vi.mock("./service-list", () => ({ ServiceList: () => <div>Service list</div> }));
vi.mock("../ui/page-section", () => ({
  PageSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section><h2>{title}</h2>{children}</section>
  )
}));
vi.mock("../ui/empty-state", () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div><h3>{title}</h3><p>{description}</p>{action}</div>
  )
}));

describe("ProjectLayerPage module discovery", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers topology discovery when an API connection exists but modules are empty", () => {
    vi.mocked(useProjectWorkspace).mockReturnValue({
      project: {
        id: "project-1",
        services: [],
        Connection: [
          { id: "connection-1", mode: "API", installationStatus: "CONNECTED" }
        ]
      },
      loading: false,
      error: null,
      reload: vi.fn()
    } as never);

    render(<ProjectLayerPage layerKey="modules" />);

    expect(screen.getByText("No modules discovered yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discover application structure" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Discover structure" }).length).toBe(1);
  });

  it("calls the scoped topology endpoint and reloads the project", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useProjectWorkspace).mockReturnValue({
      project: {
        id: "project-1",
        services: [],
        Connection: [
          { id: "connection-1", mode: "API", installationStatus: "CONNECTED" }
        ]
      },
      loading: false,
      error: null,
      reload
    } as never);
    vi.mocked(apiFetch).mockResolvedValue({
      status: "SUCCEEDED",
      moduleCount: 12,
      hierarchyCount: 12,
      summary: "Imported 12 declared modules."
    } as never);

    render(<ProjectLayerPage layerKey="modules" />);
    fireEvent.click(screen.getByRole("button", { name: "Discover application structure" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/connections/connection-1/discover-topology",
        { method: "POST", body: JSON.stringify({}) }
      );
    });
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.getByText("Imported 12 declared modules.")).toBeInTheDocument();
  });

  it("does not invent a discovery action without an API connection", () => {
    vi.mocked(useProjectWorkspace).mockReturnValue({
      project: { id: "project-1", services: [], Connection: [] },
      loading: false,
      error: null,
      reload: vi.fn()
    } as never);

    render(<ProjectLayerPage layerKey="modules" />);

    expect(screen.queryByRole("button", { name: /Discover application structure/i })).not.toBeInTheDocument();
    expect(screen.getByText("Service cards")).toBeInTheDocument();
  });
});
