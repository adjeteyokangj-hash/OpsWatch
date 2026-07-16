import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectWorkspaceNav,
  buildProjectNavGroups,
  findActiveProjectNavGroupLabel,
  isProjectNavLinkActive,
  projectNavStorageKey
} from "./project-workspace-nav";

const mockPathname = vi.fn(() => "/projects/proj-1/insights");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname()
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

describe("buildProjectNavGroups", () => {
  it("returns grouped sections with expected labels and routes", () => {
    const groups = buildProjectNavGroups("proj-1");
    expect(groups.map((group) => group.label)).toEqual([
      "Core Operations",
      "Reliability",
      "Automation & Intelligence",
      "Administration"
    ]);

    const labels = groups.flatMap((group) => group.links.map((link) => link.label));
    expect(labels).toEqual([
      "Overview",
      "Topology",
      "Modules",
      "Components",
      "Workflows",
      "Checks",
      "Alerts",
      "Incidents",
      "Dependencies & SLOs",
      "Automation",
      "Intelligence",
      "Predictions",
      "Incident Memory",
      "Integrations",
      "Policies",
      "Contacts",
      "Billing",
      "Configuration"
    ]);

    expect(labels).not.toContain("Monitored Areas");
    expect(labels).not.toContain("Service Map");
    expect(labels).not.toContain("Services");
  });

  it("keeps integrations on the project-scoped integrations route", () => {
    const integrations = buildProjectNavGroups("proj-1")
      .flatMap((group) => group.links)
      .find((link) => link.label === "Integrations");
    expect(integrations?.href).toBe("/integrations/proj-1");
  });
});

describe("isProjectNavLinkActive", () => {
  it("marks intelligence and predictions separately via hash", () => {
    const intelligence = { label: "Intelligence", href: "/projects/proj-1/insights" };
    const predictions = {
      label: "Predictions",
      href: "/projects/proj-1/insights",
      hash: "#predictions"
    };

    expect(isProjectNavLinkActive("/projects/proj-1/insights", intelligence, "")).toBe(true);
    expect(isProjectNavLinkActive("/projects/proj-1/insights", predictions, "#predictions")).toBe(true);
    expect(isProjectNavLinkActive("/projects/proj-1/insights", predictions, "")).toBe(false);
    expect(isProjectNavLinkActive("/projects/proj-1/insights", intelligence, "#predictions")).toBe(false);
  });

  it("keeps Overview exact-match so nested routes do not activate it", () => {
    const overview = { label: "Overview", href: "/projects/proj-1" };
    expect(isProjectNavLinkActive("/projects/proj-1", overview, "")).toBe(true);
    expect(isProjectNavLinkActive("/projects/proj-1/topology", overview, "")).toBe(false);
  });
});

describe("findActiveProjectNavGroupLabel", () => {
  it("opens Automation & Intelligence for predictions and incident memory hashes", () => {
    expect(findActiveProjectNavGroupLabel("proj-1", "/projects/proj-1/insights", "#predictions")).toBe(
      "Automation & Intelligence"
    );
    expect(findActiveProjectNavGroupLabel("proj-1", "/projects/proj-1/topology", "#incident-memory")).toBe(
      "Automation & Intelligence"
    );
  });

  it("opens Core Operations for topology without incident-memory hash", () => {
    expect(findActiveProjectNavGroupLabel("proj-1", "/projects/proj-1/topology", "")).toBe("Core Operations");
  });
});

describe("ProjectWorkspaceNav", () => {
  const memoryStore = new Map<string, string>();

  beforeEach(() => {
    mockPathname.mockReturnValue("/projects/proj-1/insights");
    memoryStore.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memoryStore.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memoryStore.set(key, String(value));
        },
        removeItem: (key: string) => {
          memoryStore.delete(key);
        },
        clear: () => memoryStore.clear()
      }
    });
    window.location.hash = "";
  });

  afterEach(() => cleanup());

  it("renders accordion section triggers and only one open panel by default", () => {
    render(<ProjectWorkspaceNav projectId="proj-1" />);

    expect(screen.getByRole("button", { name: /Core Operations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reliability/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Automation & Intelligence/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: /Administration/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    expect(screen.getByRole("link", { name: "Predictions" })).toHaveAttribute(
      "href",
      "/projects/proj-1/insights#predictions"
    );

    fireEvent.click(screen.getByRole("button", { name: /Reliability/i }));
    expect(screen.getByRole("link", { name: "Dependencies & SLOs" })).toHaveAttribute(
      "href",
      "/projects/proj-1/reliability"
    );
  });

  it("opens only the clicked section and persists the preference", () => {
    render(<ProjectWorkspaceNav projectId="proj-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Administration/i }));

    expect(screen.getByRole("button", { name: /Administration/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: /Automation & Intelligence/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(window.localStorage.getItem(projectNavStorageKey("proj-1"))).toBe("Administration");

    const adminRegion = screen.getByRole("region", { name: "Administration" });
    expect(within(adminRegion).getByRole("link", { name: "Billing" })).toBeInTheDocument();
  });
});
