import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntegrationsShowcase } from "./integrations-showcase";

describe("IntegrationsShowcase", () => {
  it("labels Advanced Observability Integrations as Available", () => {
    render(<IntegrationsShowcase />);
    const title = screen.getByRole("heading", { name: "Advanced Observability Integrations" });
    const card = title.closest("article");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Available");
    expect(card).not.toHaveTextContent("Live");
    expect(card).not.toHaveTextContent(/datadog|dynatrace/i);
    expect(card).toHaveTextContent(
      "Connect supported monitoring and telemetry sources to bring application health, performance signals and dependency information into OpsWatch."
    );
  });
});
