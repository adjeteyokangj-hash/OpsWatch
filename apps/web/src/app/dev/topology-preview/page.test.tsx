import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TopologyPreviewPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("topology development preview production guard", () => {
  it("renders only the development-only notice without a graph in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<TopologyPreviewPage />);
    expect(screen.getByText("Topology preview is available in local development only.")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("NiiNai (local preview)")).not.toBeInTheDocument();
    expect(screen.queryByText("Kanewu")).not.toBeInTheDocument();
  });
});
