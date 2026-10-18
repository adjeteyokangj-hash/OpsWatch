export type TopologyViewPrefs = {
  zoomPercent: number | null;
  propertyFocusId: string | null;
  cardsExpanded: "none" | "selected" | "all";
};

const storageKey = (projectId: string): string =>
  `opswatch:topology-view-prefs:${projectId}`;

export const defaultTopologyViewPrefs = (): TopologyViewPrefs => ({
  zoomPercent: null,
  propertyFocusId: null,
  cardsExpanded: "selected"
});

export const readTopologyViewPrefs = (projectId: string): TopologyViewPrefs => {
  if (typeof window === "undefined") return defaultTopologyViewPrefs();
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return defaultTopologyViewPrefs();
    const parsed = JSON.parse(raw) as Partial<TopologyViewPrefs>;
    return {
      zoomPercent:
        typeof parsed.zoomPercent === "number" && Number.isFinite(parsed.zoomPercent)
          ? Math.max(25, Math.min(200, Math.round(parsed.zoomPercent)))
          : null,
      propertyFocusId:
        typeof parsed.propertyFocusId === "string" && parsed.propertyFocusId.length > 0
          ? parsed.propertyFocusId
          : null,
      cardsExpanded:
        parsed.cardsExpanded === "none" ||
        parsed.cardsExpanded === "selected" ||
        parsed.cardsExpanded === "all"
          ? parsed.cardsExpanded
          : "selected"
    };
  } catch {
    return defaultTopologyViewPrefs();
  }
};

export const writeTopologyViewPrefs = (
  projectId: string,
  prefs: Partial<TopologyViewPrefs>
): void => {
  if (typeof window === "undefined") return;
  try {
    const current = readTopologyViewPrefs(projectId);
    const next: TopologyViewPrefs = {
      zoomPercent:
        prefs.zoomPercent === undefined ? current.zoomPercent : prefs.zoomPercent,
      propertyFocusId:
        prefs.propertyFocusId === undefined
          ? current.propertyFocusId
          : prefs.propertyFocusId,
      cardsExpanded:
        prefs.cardsExpanded === undefined ? current.cardsExpanded : prefs.cardsExpanded
    };
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
};
