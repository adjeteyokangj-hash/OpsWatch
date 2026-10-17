"use client";

import { FormEvent, useState } from "react";
import { HealthBadge } from "../health/health-badge";
import { PageSection } from "../ui/page-section";
import { apiFetch } from "../../lib/api";

export type ComputerRow = {
  deviceId: string;
  displayName: string;
  propertyId?: string | null;
  presence: "ONLINE" | "OFFLINE" | string;
  appVersion?: string | null;
  versionNote?: string | null;
  lifecycleSync?: string | null;
  financialSync?: string | null;
  lastSeenAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
};

type CloudStatus = {
  label: string;
  status: string;
};

const syncPresentation = (value?: string | null): { status: string; label: string } => {
  if (value === "HEALTHY") return { status: "HEALTHY", label: "Healthy" };
  if (value === "DELAYED") return { status: "DEGRADED", label: "Delayed" };
  if (value === "FAILED") return { status: "DOWN", label: "Failed" };
  return { status: "UNKNOWN", label: "Waiting" };
};

const when = (value?: string | null): string => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

export function ProjectComputersPanel({
  projectId,
  devices,
  cloud,
  persistKey
}: {
  projectId: string;
  devices: ComputerRow[];
  cloud?: CloudStatus | null;
  persistKey: string;
}) {
  const [rows, setRows] = useState(devices);
  const [error, setError] = useState<string | null>(null);

  const saveLabel = async (event: FormEvent<HTMLFormElement>, deviceId: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") ?? "").trim();
    setError(null);
    try {
      const response = await apiFetch<{ device: ComputerRow }>(
        `/projects/${projectId}/devices/${deviceId}`,
        { method: "PATCH", body: JSON.stringify({ label: label || null }) }
      );
      setRows((current) =>
        current.map((row) => (row.deviceId === deviceId ? { ...row, ...response.device } : row))
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not rename this computer");
    }
  };

  return (
    <PageSection
      title="Computers"
      description="Each installed NiiNai application reports on its own. Offline means that computer has not sent a heartbeat for 10 minutes. Switching a computer off does not open an incident."
      persistKey={persistKey}
      data-testid="project-computers"
    >
      {cloud ? (
        <p>
          Cloud database{" "}
          <HealthBadge status={cloud.status} displayLabel={cloud.label} />
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {rows.length === 0 ? (
        <p>No computers have reported yet. Each computer appears here after its first heartbeat.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Computer</th>
                <th>Status</th>
                <th>Booking sync</th>
                <th>Phone transactions sync</th>
                <th>Version</th>
                <th>Last communication</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const booking = syncPresentation(row.lifecycleSync);
                const financial = syncPresentation(row.financialSync);
                return (
                  <tr key={row.deviceId} data-testid={`computer-${row.deviceId}`}>
                    <td>
                      <form onSubmit={(event) => void saveLabel(event, row.deviceId)}>
                        <input
                          name="label"
                          aria-label={`Name for ${row.displayName}`}
                          defaultValue={row.displayName}
                          maxLength={80}
                        />
                        <button type="submit">Save name</button>
                      </form>
                    </td>
                    <td>
                      <HealthBadge
                        status={row.presence === "OFFLINE" ? "OFFLINE" : "ONLINE"}
                        displayLabel={row.presence === "OFFLINE" ? "Offline" : "Online"}
                      />
                    </td>
                    <td>
                      <HealthBadge status={booking.status} displayLabel={booking.label} />
                    </td>
                    <td>
                      <HealthBadge status={financial.status} displayLabel={financial.label} />
                    </td>
                    <td>
                      {row.appVersion ?? "—"}
                      {row.versionNote ? <div>{row.versionNote}</div> : null}
                    </td>
                    <td>{when(row.lastSeenAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  );
}
