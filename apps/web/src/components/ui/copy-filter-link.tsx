"use client";

import { useCallback } from "react";

type Props = {
  label?: string;
};

/**
 * Button that copies the current page URL to the clipboard.
 * Safe to render server-side — button is inert until JS hydrates.
 */
export function CopyFilterLink({ label = "Copy filter link" }: Props) {
  const copy = useCallback(() => {
    if (typeof window !== "undefined") {
      void navigator.clipboard.writeText(window.location.href);
    }
  }, []);

  return (
    <button type="button" className="secondary-button copy-link-btn" onClick={copy}>
      {label}
    </button>
  );
}
