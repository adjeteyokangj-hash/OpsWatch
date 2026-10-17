"use client";

import { HealthBadge } from "../health/health-badge";
import { PageSection } from "../ui/page-section";

export type UserSessionRow = {
  sessionId: string;
  installationId: string;
  appVersion?: string | null;
  presence: "ONLINE" | "OFFLINE" | "ENDED" | string;
  lifecycleSync?: string | null;
  financialSync?: string | null;
  lastSeenAt?: string | null;
};

export type MonitoredUserRow = {
  userId: string;
  displayName: string;
  role: string;
  propertyAccess: string;
  status: "ONLINE" | "OFFLINE" | "NEVER_CONNECTED" | "SUSPENDED" | string;
  statusLabel: string;
  sessions: number;
  sessionDetails?: UserSessionRow[];
};

const syncLabel = (value?: string | null): string => {
  if (value === "HEALTHY") return "Healthy";
  if (value === "DELAYED") return "Delayed";
  if (value === "FAILED") return "Failed";
  return "Waiting";
};

export function ProjectUsersPanel({
  users,
  persistKey
}: {
  users: MonitoredUserRow[];
  persistKey: string;
}) {
  return (
    <PageSection
      title="Users"
      description="Authorised NiiNai staff come from the staff directory. A user is Online when at least one signed-in session has sent a heartbeat in the last 10 minutes. Signing out, or leaving the application closed, does not open an incident."
      persistKey={persistKey}
      data-testid="project-users"
    >
      {users.length === 0 ? (
        <p>No authorised users have been received from the NiiNai staff directory yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Property Access</th>
              <th>Status</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>{user.displayName}</td>
                <td>{user.role}</td>
                <td>{user.propertyAccess}</td>
                <td>
                  <HealthBadge status={user.status} displayLabel={user.statusLabel} />
                </td>
                <td>{user.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {users.some((user) => (user.sessionDetails ?? []).length > 0) ? (
        <div>
          {users.map((user) =>
            (user.sessionDetails ?? []).length === 0 ? null : (
              <section key={`${user.userId}-sessions`}>
                <h3>
                  {user.displayName} sessions
                </h3>
                <ul>
                  {(user.sessionDetails ?? []).map((session) => (
                    <li key={session.sessionId}>
                      {user.status === "SUSPENDED" ? "Recorded" : session.presence === "ONLINE" ? "Online" : "Offline"} · version {session.appVersion ?? "—"} · bookings {syncLabel(session.lifecycleSync)} · financial {syncLabel(session.financialSync)}
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </div>
      ) : null}
    </PageSection>
  );
}
