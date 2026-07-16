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

    const details = screen.getByText("Overview").closest("details");
    expect(details).toBeTruthy();
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(details?.querySelector(".page-section-chevron")).toBeTruthy();
  });

  it("starts collapsed when defaultCollapsed is set", () => {
    render(
      <PageSection title="Timeline" defaultCollapsed>
        <p>Hidden until expanded</p>
      </PageSection>
    );

    const details = screen.getByText("Timeline").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("toggles open state from the summary header", () => {
    render(
      <PageSection title="Checks">
        <p>Check rows</p>
      </PageSection>
    );

    const summary = screen.getByText("Checks").closest("summary");
    expect(summary).toBeTruthy();
    fireEvent.click(summary!);

    const details = screen.getByText("Checks").closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(summary!);
    expect(details).toHaveAttribute("open");
  });

  it("persists collapse state when persistKey is provided", () => {
    const key = "project:proj-1:checks";
    const { unmount } = render(
      <PageSection title="Recent checks" persistKey={key}>
        <p>Rows</p>
      </PageSection>
    );

    fireEvent.click(screen.getByText("Recent checks").closest("summary")!);
    expect(window.localStorage.getItem(pageSectionStorageKey(key))).toBe("collapsed");
    unmount();

    render(
      <PageSection title="Recent checks" persistKey={key}>
        <p>Rows</p>
      </PageSection>
    );

    expect(screen.getByText("Recent checks").closest("details")).not.toHaveAttribute("open");
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
    expect(screen.getByText("Alerts").closest("details")).toHaveAttribute("open");
  });

  it("supports a non-collapsible static panel", () => {
    render(
      <PageSection title="Static" collapsible={false}>
        <p>Always visible</p>
      </PageSection>
    );

    expect(screen.getByText("Static").closest("details")).toBeNull();
    expect(screen.getByText("Static").closest("section")).toBeTruthy();
    expect(screen.getByText("Always visible")).toBeInTheDocument();
  });
});
