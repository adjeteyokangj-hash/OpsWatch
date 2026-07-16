import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectWorkspaceNav,
  buildProjectNavGroups,
  isProjectNavLinkActive
} from "./project-workspace-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/proj-1/insights"
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
});

describe("ProjectWorkspaceNav", () => {
  afterEach(() => cleanup());

  it("renders grouped section headers and workspace links", () => {
    render(<ProjectWorkspaceNav projectId="proj-1" />);

    expect(screen.getByText("Core Operations")).toBeInTheDocument();
    expect(screen.getByText("Reliability")).toBeInTheDocument();
    expect(screen.getByText("Automation & Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dependencies & SLOs" })).toHaveAttribute(
      "href",
      "/projects/proj-1/reliability"
    );
    expect(screen.getByRole("link", { name: "Predictions" })).toHaveAttribute(
      "href",
      "/projects/proj-1/insights#predictions"
    );
  });
});
