"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export const normalizeProject = (row: any) => ({
  ...row,
  services: row.services ?? row.Service ?? [],
  alerts: row.alerts ?? row.Alert ?? [],
  incidents: row.incidents ?? row.Incident ?? [],
  heartbeats: row.heartbeats ?? row.Heartbeat ?? [],
  events: row.events ?? row.Event ?? [],
  integrations: row.integrations ?? row.ProjectIntegration ?? [],
  notificationChannels: row.notificationChannels ?? row.NotificationChannel ?? []
});

export function useProjectWorkspace(projectId: string | undefined) {
  const [project, setProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const row = await apiFetch<any>(`/projects/${projectId}`);
      setProject(normalizeProject(row));
    } catch (err: any) {
      setError(err?.message || "Failed to load project");
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { project, loading, error, reload };
}
