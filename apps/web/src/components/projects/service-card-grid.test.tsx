import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceCardGrid } from "./service-card-grid";

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn()
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

const rows = [
  {
    id: "svc-public-website",
    name: "Public Website",
    type: "MODULE",
    status: "HEALTHY",
    baseUrl: "https://www.noblexp.com",
    isCritical: true
  }
];

describe("ServiceCardGrid", () => {
  afterEach(() => cleanup());

  it("renders Edit and View module as separate actions with correct targets", () => {
    render(
      <ServiceCardGrid
        rows={rows}
        projectId="app-noble-express"
        primaryCta={{
          label: "View module →",
          hrefFor: (serviceId) => `/projects/app-noble-express/modules/${serviceId}`,
          ariaLabelFor: (name) => `View module ${name}`
        }}
      />
    );

    const card = screen.getByRole("article");
    const edit = within(card).getByRole("button", { name: /edit public website/i });
    const detail = within(card).getByRole("link", { name: /view module public website/i });

    expect(edit).toBeInTheDocument();
    expect(detail).toHaveTextContent("View module →");
    expect(detail).toHaveAttribute(
      "href",
      "/projects/app-noble-express/modules/svc-public-website"
    );
    expect(edit.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText("·")).toBeInTheDocument();
  });

  it("defaults primary CTA to View checks when no primaryCta is provided", () => {
    render(<ServiceCardGrid rows={rows} projectId="app-noble-express" />);

    const checks = screen.getByRole("link", { name: /view checks for public website/i });
    expect(checks).toHaveTextContent("View checks →");
    expect(checks).toHaveAttribute(
      "href",
      "/checks?projectId=app-noble-express&serviceId=svc-public-website"
    );
  });

  it("opens the inline edit form for the selected module", () => {
    render(<ServiceCardGrid rows={rows} projectId="app-noble-express" />);

    fireEvent.click(screen.getByRole("button", { name: /edit public website/i }));

    expect(screen.getByRole("heading", { name: /edit service/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Public Website")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://www.noblexp.com")).toBeInTheDocument();
  });
});
