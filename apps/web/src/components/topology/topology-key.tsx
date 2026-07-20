"use client";

import { PageSection } from "../ui/page-section";
import { TOPOLOGY_KEY_ENTRIES } from "./topology-edge-style";

type Props = {
  projectId: string;
};

export function TopologyKey({ projectId }: Props) {
  return (
    <PageSection
      title="Topology key"
      description="Line colours and styles used on the service map."
      className="topology-key"
      persistKey={`project:${projectId}:topology:key`}
      defaultCollapsed
      data-testid="topology-key"
    >
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
    </PageSection>
  );
}
