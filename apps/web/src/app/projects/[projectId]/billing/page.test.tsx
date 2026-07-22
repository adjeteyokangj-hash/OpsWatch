import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../../../lib/api";
import ProjectBillingPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" })
}));

vi.mock("../../../../lib/api", () => ({ apiFetch: vi.fn() }));

vi.mock("../../../../components/projects/project-workspace-shell", () => ({
  ProjectWorkspaceShell: ({
    actions,
    children,
    error
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    error?: string | null;
  }) => (
    <div>
      {error ? <div role="alert">{error}</div> : null}
      <div data-testid="shell-actions">{actions}</div>
      <div>{children}</div>
    </div>
  )
}));

const project = { id: "proj-1", name: "Noble Express", clientName: "Noble", environment: "production" };

const billingFree = {
  plan: "FREE",
  planCode: null,
  monthlyPrice: 0,
  currency: "GBP",
  billingStatus: "ACTIVE",
  billingInterval: "MONTHLY",
  billingStartDate: null,
  renewalDate: null,
  dataRetentionDays: 7,
  checkLimit: 10,
  userLimit: 2,
  automationRunLimit: 20,
  paymentMethod: null,
  usage: { checks: 0, automationRuns: 0, users: 0 }
};

type PatchHandler = (opts: { method?: string; body?: string }) => unknown;

const setup = (patch?: PatchHandler) => {
  vi.mocked(apiFetch).mockImplementation(async (path: string, opts?: { method?: string; body?: string }) => {
    if (path === "/projects/proj-1") return project as never;
    if (path === "/projects/proj-1/billing" && opts?.method === "PATCH") {
      return (patch ? patch(opts) : { ...billingFree }) as never;
    }
    if (path === "/projects/proj-1/billing") return { ...billingFree } as never;
    if (path === "/projects/proj-1/billing/plans") return { stripeConfigured: false, plans: [] } as never;
    if (path === "/projects/proj-1/billing/invoices") return { stripeConfigured: false, invoices: [] } as never;
    throw new Error(`Unexpected API call: ${path}`);
  });
};

describe("ProjectBillingPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires an interval review before submitting a standard plan", async () => {
    setup();
    render(<ProjectBillingPage />);
    await screen.findByText("Free plan");

    fireEvent.click(screen.getByRole("button", { name: "Choose Starter" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Review Starter plan");
    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/projects/proj-1/billing",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"billingInterval":"ANNUAL"')
        })
      );
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/projects/proj-1/billing",
      expect.objectContaining({ body: expect.stringContaining('"plan":"STARTER"') })
    );
  });

  it("keeps the server-truth plan when a confirmed plan change fails", async () => {
    setup(() => {
      throw new Error("Server rejected the change");
    });
    render(<ProjectBillingPage />);
    await screen.findByText("Free plan");

    fireEvent.click(screen.getByRole("button", { name: "Choose Starter" }));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Server rejected the change");
    expect(screen.getByText("Free plan")).toBeInTheDocument();
  });

  it("uses one form handler for the top and bottom custom-plan save buttons", async () => {
    setup();
    render(<ProjectBillingPage />);
    await screen.findByText("Free plan");

    fireEvent.change(screen.getByLabelText("Base monthly price"), { target: { value: "55" } });
    const top = screen.getByTestId("billing-save-top");
    const bottom = screen.getByTestId("billing-save-bottom");
    expect(top).toBeEnabled();
    expect(bottom).toBeEnabled();

    fireEvent.click(bottom);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/projects/proj-1/billing",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"monthlyPrice":55')
        })
      );
    });
  });

  it("does not expose manual card fields when Stripe is not connected", async () => {
    setup();
    render(<ProjectBillingPage />);
    await screen.findByText("Free plan");

    expect(screen.queryByLabelText("Card brand")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save payment method" })).not.toBeInTheDocument();
    expect(screen.getByText(/Stripe is not connected/i)).toBeInTheDocument();
  });
});
