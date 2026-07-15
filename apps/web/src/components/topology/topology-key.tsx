"use client";

import { useState } from "react";
import { TOPOLOGY_KEY_ENTRIES } from "./topology-edge-style";

export function TopologyKey() {
  const [open, setOpen] = useState(false);

  return (
    <section className="topology-key panel" data-testid="topology-key">
      <button
        type="button"
        className="topology-key-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="topology-key-toggle"
      >
        <strong>Topology key</strong>
        <span>{open ? "Hide" : "Show"} line colours and styles</span>
      </button>
      {open ? (
        <ul className="topology-key-list" data-testid="topology-key-list">
          {TOPOLOGY_KEY_ENTRIES.map((entry) => (
            <li key={entry.id} data-testid={`topology-key-entry-${entry.id}`}>
              <span className={entry.sampleClass} aria-hidden="true" />
              <div>
                <strong>{entry.label}</strong>
                <p>{entry.meaning}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
