import type { TopologyHealthStatus, TopologyNodeType } from "./topology-types";

export type TopologyViewMode = "map" | "list";

type Props = {
  typeFilter: TopologyNodeType | "ALL";
  healthFilter: TopologyHealthStatus | "ALL";
  searchQuery: string;
  viewMode: TopologyViewMode;
  onTypeFilterChange: (value: TopologyNodeType | "ALL") => void;
  onHealthFilterChange: (value: TopologyHealthStatus | "ALL") => void;
  onSearchQueryChange: (value: string) => void;
  onViewModeChange: (value: TopologyViewMode) => void;
};

export function TopologyFilterBar({
  typeFilter,
  healthFilter,
  searchQuery,
  viewMode,
  onTypeFilterChange,
  onHealthFilterChange,
  onSearchQueryChange,
  onViewModeChange
}: Props) {
  return (
    <section className="topology-filter-bar panel">
      <label className="topology-filter-field">
        <span>Node type</span>
        <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as TopologyNodeType | "ALL")}>
          <option value="ALL">All layers</option>
          <option value="APP">App</option>
          <option value="MODULE">Module</option>
          <option value="WORKFLOW">Workflow</option>
          <option value="COMPONENT">Component</option>
        </select>
      </label>
      <label className="topology-filter-field">
        <span>Health</span>
        <select value={healthFilter} onChange={(event) => onHealthFilterChange(event.target.value as TopologyHealthStatus | "ALL")}>
          <option value="ALL">All states</option>
          <option value="HEALTHY">Healthy</option>
          <option value="DEGRADED">Degraded</option>
          <option value="CRITICAL">Critical</option>
          <option value="UNKNOWN">Unknown (no conclusive signal)</option>
        </select>
      </label>
      <label className="topology-filter-field topology-filter-search">
        <span>Search</span>
        <input
          type="search"
          value={searchQuery}
          placeholder="Search nodes, services, tags…"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>
      <label className="topology-filter-field">
        <span>Group by</span>
        <select defaultValue="layer" aria-label="Group by">
          <option value="layer">Layer</option>
        </select>
      </label>
      <label className="topology-filter-field">
        <span>Layout</span>
        <select defaultValue="hierarchical" aria-label="Layout">
          <option value="hierarchical">Hierarchical</option>
        </select>
      </label>
      <div className="topology-filter-field topology-view-toggle-wrap">
        <span>View</span>
        <div className="topology-view-toggle" role="group" aria-label="Topology view mode">
          <button
            type="button"
            className={viewMode === "map" ? "active" : undefined}
            onClick={() => onViewModeChange("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : undefined}
            onClick={() => onViewModeChange("list")}
          >
            List
          </button>
        </div>
      </div>
    </section>
  );
}
