import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertRepairConfirmDrawer } from "./alert-repair-confirm-drawer";

describe("AlertRepairConfirmDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders diagnosis and confirms with optional note", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <AlertRepairConfirmDrawer
        open
        repair={{
          actionKey: "RERUN_HTTP_CHECK",
          actionLabel: "Rerun HTTP check",
          diagnosisSummary: "Private targets are blocked",
          riskLevel: "LOW",
          approvalRequired: true,
          verificationStrategy: "IMMEDIATE_CHECK_RESULT",
          whySelected: "diagnosis-ranked-registry",
          availabilityReason: "Observe",
          oneTimeOverride: true
        }}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText(/Private targets are blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/One-time administrator override/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("alert-repair-confirm"));
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});
