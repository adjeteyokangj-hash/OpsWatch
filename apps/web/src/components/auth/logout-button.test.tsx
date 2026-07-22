import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthCookies, getCsrfToken } from "../../lib/auth";
import { redirectAfterLogout } from "./logout-navigation";
import { LogoutButton } from "./logout-button";

vi.mock("../../lib/auth", () => ({
  clearAuthCookies: vi.fn(),
  getCsrfToken: vi.fn()
}));

vi.mock("../../lib/constants", () => ({ API_BASE_URL: "/api" }));
vi.mock("./logout-navigation", () => ({ redirectAfterLogout: vi.fn() }));

describe("LogoutButton", () => {
  beforeEach(() => {
    vi.mocked(getCsrfToken).mockReturnValue("csrf-token");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("revokes and verifies the server session before redirecting", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => expect(clearAuthCookies).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "x-opswatch-csrf": "csrf-token" }
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/session",
      expect.objectContaining({ credentials: "include" })
    );
    expect(redirectAfterLogout).toHaveBeenCalledTimes(1);
  });

  it("keeps the user on the page and shows an error when server logout fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid CSRF token");
    expect(clearAuthCookies).not.toHaveBeenCalled();
    expect(redirectAfterLogout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Logout" })).toBeEnabled();
  });

  it("prevents duplicate logout requests while one is active", async () => {
    let resolveLogout: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        resolveLogout = resolve;
      })
    );

    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "Logout" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Logging out…" })).toBeDisabled();

    resolveLogout?.(
      new Response(JSON.stringify({ error: "Temporary failure" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      })
    );
    await screen.findByRole("alert");
  });
});
