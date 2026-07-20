import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopologyKey } from "./topology-key";
import { TOPOLOGY_KEY_ENTRIES } from "./topology-edge-style";

describe("TopologyKey", () => {
  afterEach(() => cleanup());

  it("expands to list every documented colour and line style", () => {
    render(<TopologyKey projectId="test-project" />);
    const summary = screen.getByText("Topology key").closest("button.page-section-summary");
    expect(summary).toBeTruthy();
    fireEvent.click(summary!);
    for (const entry of TOPOLOGY_KEY_ENTRIES) {
      expect(screen.getByTestId(`topology-key-entry-${entry.id}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/purple/i)).not.toBeInTheDocument();
  });
});
