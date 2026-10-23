import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleCataloguePanel } from "./module-catalogue-panel";
import { apiFetch } from "../../lib/api";
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const payload = (canManage = true, state = "PROPOSED") => ({ projectId: "oware", canManage,
  catalogue: [{ key: "games", label: "Gameplay", description: "Game engine", source: "PLATFORM", category: "OPTIONAL", version: 1, status: "ACTIVE" }],
  assignments: [{ moduleKey: "games", state, confidence: 0.65, evidenceJson: [{ source: "description", reason: "Oware game engine" }], updatedAt: "2026-10-23T10:00:00.000Z" }],
  proposals: [{ key: "games", label: "Gameplay", state: "inferred" as const, sources: ["description"], evidence: ["Oware game engine"], requiresApproval: true as const }],
  discovery: { state: "PARTIAL", method: "EVIDENCE_RULES", aiState: "NOT_REQUESTED" }
});
describe("project module review", () => {
  it("shows applicability separately from installed health and persists approval", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(payload()).mockResolvedValueOnce({}).mockResolvedValueOnce(payload(true, "APPROVED"));
    render(<ModuleCataloguePanel projectId="oware" />);
    await screen.findByText("PROPOSED");
    expect(screen.getByRole("region", { name: "Applicability hints" })).toHaveTextContent("Gameplay");
    expect(screen.getByText(/not assignments, installed modules or health evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Installed components and operational health require separate verified evidence/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("APPROVED");
    expect(apiFetch).toHaveBeenCalledWith("/projects/oware/module-catalogue/games", { method: "PUT", body: JSON.stringify({ state: "APPROVED", expectedUpdatedAt: "2026-10-23T10:00:00.000Z" }) });
    expect(screen.getByRole("combobox", { name: "Topology component for Gameplay" })).toHaveValue("");
  });
  it("does not give viewers mutation controls", async () => {
    vi.mocked(apiFetch).mockResolvedValue(payload(false)); render(<ModuleCataloguePanel projectId="oware" />);
    await screen.findByText("PROPOSED"); expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("Administrator review required")).toBeInTheDocument();
  });
  it("reports incomplete or failed API responses without inventing assignments", async () => {
    vi.mocked(apiFetch).mockResolvedValue({}); render(<ModuleCataloguePanel projectId="oware" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Catalogue response was incomplete"));
    expect(screen.queryByText("APPROVED")).not.toBeInTheDocument();
  });
});
