import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageSection, pageSectionStorageKey } from "./page-section";

describe("PageSection", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear()
      }
    });
  });

  afterEach(() => {
    cleanup();
    store.clear();
  });

  it("renders as an expandable disclosure open by default", () => {
    render(
      <PageSection title="Overview" description="Primary panel">
        <p>Body content</p>
      </PageSection>
    );

    const details = screen.getByText("Overview").closest("section.page-section");
    expect(details).toBeTruthy();
    expect(details).toHaveAttribute("data-open", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(details?.querySelector(".page-section-chevron")).toBeTruthy();
  });

  it("keeps phrasing-only content inside the summary button (no headings)", () => {
    render(
      <PageSection title="Overview" description="Primary panel">
        <p>Body content</p>
      </PageSection>
    );

    const summary = screen.getByText("Overview").closest("button.page-section-summary");
    expect(summary).toBeTruthy();
    expect(summary?.querySelector("h1, h2, h3, h4, h5, h6, p")).toBeNull();
    expect(summary?.querySelector(".page-section-title")?.tagName).toBe("SPAN");
    expect(summary?.querySelector(".page-section-description")?.tagName).toBe("SPAN");
  });

  it("starts collapsed when defaultCollapsed is set", () => {
    render(
      <PageSection title="Timeline" defaultCollapsed>
        <p>Hidden until expanded</p>
      </PageSection>
    );

    const details = screen.getByText("Timeline").closest("section.page-section");
    expect(details).toHaveAttribute("data-open", "false");
  });

  it("toggles open state from the summary header", () => {
    render(
      <PageSection title="Checks">
        <p>Check rows</p>
      </PageSection>
    );

    const summary = screen.getByText("Checks").closest("button.page-section-summary");
    expect(summary).toBeTruthy();
    fireEvent.click(summary!);

    const details = screen.getByText("Checks").closest("section.page-section");
    expect(details).toHaveAttribute("data-open", "false");

    fireEvent.click(summary!);
    expect(details).toHaveAttribute("data-open", "true");
  });

  it("persists collapse state when persistKey is provided", () => {
    const key = "project:proj-1:checks";
    const { unmount } = render(
      <PageSection title="Recent checks" persistKey={key}>
        <p>Rows</p>
      </PageSection>
    );

    fireEvent.click(screen.getByText("Recent checks").closest("button.page-section-summary")!);
    expect(window.localStorage.getItem(pageSectionStorageKey(key))).toBe("collapsed");
    unmount();

    render(
      <PageSection title="Recent checks" persistKey={key}>
        <p>Rows</p>
      </PageSection>
    );

    expect(screen.getByText("Recent checks").closest("section.page-section")).toHaveAttribute("data-open", "false");
  });

  it("does not toggle when clicking header actions", () => {
    render(
      <PageSection
        title="Alerts"
        actions={
          <button type="button" data-testid="section-action">
            View all
          </button>
        }
      >
        <p>Alert list</p>
      </PageSection>
    );

    fireEvent.click(screen.getByTestId("section-action"));
    expect(screen.getByText("Alerts").closest("section.page-section")).toHaveAttribute("data-open", "true");
  });

  it("exposes aria-expanded on the summary control", () => {
    render(
      <PageSection title="Registry">
        <p>Rows</p>
      </PageSection>
    );

    const summary = screen.getByText("Registry").closest("button.page-section-summary");
    expect(summary).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(summary!);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles via keyboard activation on the summary", () => {
    render(
      <PageSection title="Keyboard panel">
        <p>Body</p>
      </PageSection>
    );

    const summary = screen.getByText("Keyboard panel").closest("button.page-section-summary")!;
    summary.focus();
    fireEvent.keyDown(summary, { key: "Enter", code: "Enter" });
    fireEvent.click(summary);

    expect(screen.getByText("Keyboard panel").closest("section.page-section")).toHaveAttribute("data-open", "false");
  });

  it("keeps form field values when collapsed and reopened", () => {
    render(
      <PageSection title="Config form" persistKey="settings:demo-form">
        <input aria-label="Endpoint" defaultValue="" data-testid="endpoint-input" />
      </PageSection>
    );

    const input = screen.getByTestId("endpoint-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://example.test/hooks" } });
    expect(input.value).toBe("https://example.test/hooks");

    const summary = screen.getByText("Config form").closest("button.page-section-summary")!;
    fireEvent.click(summary);
    expect(screen.getByText("Config form").closest("section.page-section")).toHaveAttribute("data-open", "false");
    fireEvent.click(summary);

    expect((screen.getByTestId("endpoint-input") as HTMLInputElement).value).toBe(
      "https://example.test/hooks"
    );
  });

  it("collapses multiple sections independently", () => {
    render(
      <>
        <PageSection title="First" persistKey="demo:first">
          <p>A</p>
        </PageSection>
        <PageSection title="Second" persistKey="demo:second">
          <p>B</p>
        </PageSection>
      </>
    );

    fireEvent.click(screen.getByText("First").closest("button.page-section-summary")!);
    expect(screen.getByText("First").closest("section.page-section")).toHaveAttribute("data-open", "false");
    expect(screen.getByText("Second").closest("section.page-section")).toHaveAttribute("data-open", "true");
  });

  it("scopes persistence by dynamic project keys", () => {
    const projectA = "project:proj-a:alerts";
    const projectB = "project:proj-b:alerts";

    const { unmount } = render(
      <PageSection title="Alerts" persistKey={projectA}>
        <p>A alerts</p>
      </PageSection>
    );
    fireEvent.click(screen.getByText("Alerts").closest("button.page-section-summary")!);
    expect(window.localStorage.getItem(pageSectionStorageKey(projectA))).toBe("collapsed");
    unmount();

    render(
      <PageSection title="Alerts" persistKey={projectB}>
        <p>B alerts</p>
      </PageSection>
    );
    expect(screen.getByText("Alerts").closest("section.page-section")).toHaveAttribute("data-open", "true");
    expect(window.localStorage.getItem(pageSectionStorageKey(projectB))).toBeNull();
  });
});
