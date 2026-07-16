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

  it("renders Edit and View checks as separate actions with correct targets", () => {
    render(<ServiceCardGrid rows={rows} projectId="app-noble-express" />);

    const card = screen.getByRole("article");
    const edit = within(card).getByRole("button", { name: /edit public website/i });
    const checks = within(card).getByRole("link", { name: /view checks for public website/i });

    expect(edit).toBeInTheDocument();
    expect(checks).toHaveAttribute(
      "href",
      "/checks?projectId=app-noble-express&serviceId=svc-public-website"
    );
    expect(edit.compareDocumentPosition(checks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText("·")).toBeInTheDocument();
  });

  it("opens the inline edit form for the selected module", () => {
    render(<ServiceCardGrid rows={rows} projectId="app-noble-express" />);

    fireEvent.click(screen.getByRole("button", { name: /edit public website/i }));

    expect(screen.getByRole("heading", { name: /edit service/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Public Website")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://www.noblexp.com")).toBeInTheDocument();
  });
});
