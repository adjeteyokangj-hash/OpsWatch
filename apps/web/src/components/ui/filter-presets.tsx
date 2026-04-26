"use client";

import Link from "next/link";

export type FilterPreset = {
  label: string;
  params: Record<string, string>;
};

type Props = {
  basePath: string;
  presets: FilterPreset[];
  currentParams: string;
};

/**
 * Renders a row of quick-filter preset chips. Each chip links to `basePath`
 * with the preset query params merged in. Clicking a chip that is already
 * active (all its params match the URL) acts as a clear toggle.
 */
export function FilterPresets({ basePath, presets, currentParams }: Props) {
  const active = new URLSearchParams(currentParams);

  return (
    <div className="filter-presets">
      {presets.map((preset) => {
        const target = new URLSearchParams();
        Object.entries(preset.params).forEach(([k, v]) => target.set(k, v));

        const isActive = Object.entries(preset.params).every(
          ([k, v]) => active.get(k) === v
        );

        return isActive ? (
          <Link
            key={preset.label}
            href={basePath}
            className="preset-chip preset-chip--active"
            title="Click to clear this preset"
          >
            {preset.label} ×
          </Link>
        ) : (
          <Link
            key={preset.label}
            href={`${basePath}?${target.toString()}`}
            className="preset-chip"
          >
            {preset.label}
          </Link>
        );
      })}
    </div>
  );
}
