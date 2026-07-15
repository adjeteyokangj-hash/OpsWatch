import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopologyKey } from "./topology-key";
import { TOPOLOGY_KEY_ENTRIES } from "./topology-edge-style";

describe("TopologyKey", () => {
  afterEach(() => cleanup());

  it("expands to list every documented colour and line style", () => {
    render(<TopologyKey />);
    fireEvent.click(screen.getByTestId("topology-key-toggle"));
    for (const entry of TOPOLOGY_KEY_ENTRIES) {
      expect(screen.getByTestId(`topology-key-entry-${entry.id}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/purple/i)).not.toBeInTheDocument();
  });
});
