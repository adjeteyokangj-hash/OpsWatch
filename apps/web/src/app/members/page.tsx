"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { getAuthClaims } from "../../lib/auth";
import { generatePassword } from "../../lib/password-generator";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

type AuditLogRow = {
  id: string;
  action: string;
  entityId: string;
  subjectEmail: string | null;
  subjectName: string | null;
  actor: { id: string; email: string; name: string } | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type ProjectContactEmailRow = {
  projectId: string;
  projectName: string;
  projectOwner: string | null;
  operationalContact: string | null;
  notificationEmails: string[];
};

type ManagementCenter = {
  users: UserRow[];
  registeredEmails: string[];
  auditLogs: AuditLogRow[];
  activeAdminCount: number;
  projectContactEmails: ProjectContactEmailRow[];
};

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
  { value: "INCIDENT_RESPONDER", label: "Incident responder" },
  { value: "AUTOMATION_OPERATOR", label: "Automation operator" }
] as const;

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((row) => [row.value, row.label])) as Record<string, string>;

const formatAuditAction = (action: string): string =>
  action
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const loadAdminCenter = async (): Promise<ManagementCenter> => {
  try {
    return await apiFetch<ManagementCenter>("/users/management-center");
  } catch (err: any) {
    const message = String(err?.message || "");
    if (!message.includes("404")) {
      throw err;
    }

    const [users, auditLogs] = await Promise.all([
      apiFetch<UserRow[]>("/users"),
      apiFetch<AuditLogRow[]>("/users/audit-logs").catch(() => [] as AuditLogRow[])
    ]);

    return {
      users,
      registeredEmails: users.map((row) => row.email).sort(),
      auditLogs,
      activeAdminCount: users.filter((row) => row.role === "ADMIN" && row.isActive).length,
      projectContactEmails: []
    };
  }
};

export default function MembersPage() {
  const [center, setCenter] = useState<ManagementCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"members" | "emails" | "logs">("members");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "", role: "MEMBER", password: "" });
  const [showGeneratedPassword, setShowGeneratedPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = async (admin: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (admin) {
        setCenter(await loadAdminCenter());
      } else {
        const rows = await apiFetch<UserRow[]>("/users");
        setCenter({ users: rows, registeredEmails: rows.map((row) => row.email), auditLogs: [], activeAdminCount: 0, projectContactEmails: [] });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load platform members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const claims = getAuthClaims();
    const admin = claims?.role === "ADMIN";
    setCurrentUserId(typeof claims?.sub === "string" ? claims.sub : null);
    setIsAdmin(admin);
    void load(admin);
  }, []);

  const reload = async () => load(isAdmin);

  const users = center?.users ?? [];
  const isLastActiveAdmin = (user: UserRow): boolean =>
    user.role === "ADMIN" && user.isActive && (center?.activeAdminCount ?? 0) <= 1;

  const protectedAdmin = useMemo(
    () => users.find((user) => isLastActiveAdmin(user)) ?? null,
    [users, center?.activeAdminCount]
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const created = await apiFetch<UserRow & { inviteOutcome?: "created" | "reattached" | "already_in_org" }>(
        "/auth/invite",
        {
          method: "POST",
          body: JSON.stringify(createForm)
        }
      );
      const successByOutcome: Record<string, string> = {
        already_in_org: `${createForm.email} is already a member of this organization.`,
        reattached: `${createForm.email} was added to this organization. Share the initial password securely.`,
        created: `Created ${createForm.email}. Share the initial password securely.`
      };
      setSuccessMsg(
        successByOutcome[created.inviteOutcome ?? "created"] ?? successByOutcome.created ?? "Member saved."
      );
      setCreateForm({ name: "", email: "", role: "MEMBER", password: "" });
      setShowGeneratedPassword(false);
      setShowCreate(false);
      await reload();
    } catch (err: any) {
      setError(err?.message || "Failed to create member");
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (userId: string, role: string) => {
    setError(null);
    try {
      await apiFetch(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      await reload();
    } catch (err: any) {
      setError(err?.message || "Failed to update role");
    }
  };

  const deactivateUser = async (user: UserRow) => {
    if (user.id === currentUserId) {
      setError("You cannot deactivate your own account.");
      return;
    }
    if (isLastActiveAdmin(user)) {
      setError("Cannot deactivate the last active admin.");
      return;
    }
    if (!window.confirm(`Deactivate ${user.email}?`)) return;
    setError(null);
    try {
      await apiFetch(`/users/${user.id}/deactivate`, { method: "POST", body: "{}" });
      await reload();
    } catch (err: any) {
      setError(err?.message || "Failed to deactivate member");
    }
  };

  const reactivateUser = async (user: UserRow) => {
    setError(null);
    try {
      await apiFetch(`/users/${user.id}/reactivate`, { method: "POST", body: "{}" });
      await reload();
    } catch (err: any) {
      setError(err?.message || "Failed to reactivate member");
    }
  };

  const submitPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetTarget) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword })
      });
      setSuccessMsg(`Password reset for ${resetTarget.email}.`);
      setResetTarget(null);
      setResetPassword("");
      setShowResetPassword(false);
      await reload();
    } catch (err: any) {
      setError(err?.message || "Failed to reset password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Header title="Members" />
      <p className="dashboard-subtle">
        OpsWatch platform accounts for your organization — login access, roles, and activity. This is separate from project
        operational contacts inside each project.
      </p>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {successMsg ? <section className="panel success-panel">{successMsg}</section> : null}
      {protectedAdmin ? (
        <section className="panel">
          <p className="dashboard-subtle">
            <strong>{protectedAdmin.email}</strong> is the last active admin and cannot be demoted or deactivated until another admin is active.
          </p>
        </section>
      ) : null}

      <section className="pill-row">
        <button type="button" className={tab === "members" ? "pill active" : "pill"} onClick={() => setTab("members")}>
          Platform members
        </button>
        <button type="button" className={tab === "emails" ? "pill active" : "pill"} onClick={() => setTab("emails")}>
          Registered emails
        </button>
        {isAdmin ? (
          <button type="button" className={tab === "logs" ? "pill active" : "pill"} onClick={() => setTab("logs")}>
            Activity log
          </button>
        ) : null}
      </section>

      {showCreate && isAdmin ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Create platform member</h2>
              <p>Add someone who can log in to OpsWatch with a role and initial password.</p>
            </div>
            <button className="secondary-button" onClick={() => setShowCreate(false)} data-action="local-ui">
              Cancel
            </button>
          </div>
          <form className="stack-form" onSubmit={(event) => void handleCreate(event)}>
            <label>
              Name
              <input
                value={createForm.name}
                onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Role
              <select
                value={createForm.role}
                onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Initial password
              <div className="password-field-row">
                <input
                  type={showGeneratedPassword ? "text" : "password"}
                  value={createForm.password}
                  onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  minLength={16}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setCreateForm((current) => ({ ...current, password: generatePassword() }));
                    setShowGeneratedPassword(true);
                  }}
                  data-action="local-ui"
                >
                  Generate
                </button>
              </div>
            </label>
            <button type="submit" disabled={saving} data-action="api" data-endpoint="/auth/invite">
              {saving ? "Creating…" : "Create member"}
            </button>
          </form>
        </section>
      ) : null}

      {resetTarget && isAdmin ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Reset password</h2>
              <p>Set a new password for {resetTarget.email}.</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setResetTarget(null);
                setResetPassword("");
                setShowResetPassword(false);
              }}
              data-action="local-ui"
            >
              Cancel
            </button>
          </div>
          <form className="stack-form" onSubmit={(event) => void submitPasswordReset(event)}>
            <label>
              New password
              <div className="password-field-row">
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  required
                  minLength={16}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setResetPassword(generatePassword());
                    setShowResetPassword(true);
                  }}
                  data-action="local-ui"
                >
                  Generate
                </button>
              </div>
            </label>
            <button type="submit" disabled={saving} data-action="api" data-endpoint="/users/:id/reset-password">
              {saving ? "Saving…" : "Reset password"}
            </button>
          </form>
        </section>
      ) : null}

      {loading ? <section className="panel">Loading platform members…</section> : null}

      {!loading && tab === "members" ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Platform members</h2>
              <p>{users.length} OpsWatch account{users.length === 1 ? "" : "s"} in this organization.</p>
            </div>
            {isAdmin && !showCreate ? (
              <button className="primary-button" onClick={() => setShowCreate(true)} data-action="local-ui">
                + Create member
              </button>
            ) : null}
          </div>
          {!isAdmin ? <p className="dashboard-subtle">Only admins can create members or change access.</p> : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                {isAdmin ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const lastAdmin = isLastActiveAdmin(user);
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          aria-label={`Role for ${user.email}`}
                          value={user.role}
                          disabled={lastAdmin}
                          onChange={(event) => void updateRole(user.id, event.target.value)}
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABELS[user.role] ?? user.role
                      )}
                    </td>
                    <td>
                      <span className={`result-pill ${user.isActive ? "pass" : "fail"}`}>
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    {isAdmin ? (
                      <td className="table-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setResetTarget(user);
                            setResetPassword("");
                            setShowResetPassword(false);
                          }}
                          data-action="local-ui"
                        >
                          Reset password
                        </button>
                        {user.isActive ? (
                          <button
                            type="button"
                            className="danger-button"
                            disabled={lastAdmin || user.id === currentUserId}
                            onClick={() => void deactivateUser(user)}
                            data-action="api"
                            data-endpoint="/users/:id/deactivate"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void reactivateUser(user)}
                            data-action="api"
                            data-endpoint="/users/:id/reactivate"
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {!loading && tab === "emails" ? (
        <>
          <section className="panel">
            <h2>Registered emails</h2>
            <p className="dashboard-subtle">All email addresses with OpsWatch login accounts in this organization.</p>
            {(center?.registeredEmails ?? []).length === 0 ? (
              <p>No platform login emails yet.</p>
            ) : (
              <ul className="dashboard-list">
                {(center?.registeredEmails ?? []).map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Project contact emails</h2>
            <p className="dashboard-subtle">
              Operational contacts and alert notification emails configured on projects. These are separate from OpsWatch login
              accounts.
            </p>
            {(center?.projectContactEmails ?? []).length === 0 ? (
              <p>No projects in this organization.</p>
            ) : (
              <div className="layer-health-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Owner</th>
                      <th>Operational contact</th>
                      <th>Notification emails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(center?.projectContactEmails ?? []).map((row) => (
                        <tr key={row.projectId}>
                          <td>
                            <strong>{row.projectName}</strong>
                          </td>
                          <td>{row.projectOwner?.trim() || "—"}</td>
                          <td>{row.operationalContact?.trim() || "—"}</td>
                          <td>{row.notificationEmails.length > 0 ? row.notificationEmails.join(", ") : "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {(center?.projectContactEmails ?? []).every(
              (row) =>
                !row.projectOwner?.trim() && !row.operationalContact?.trim() && row.notificationEmails.length === 0
            ) ? (
              <p className="dashboard-subtle">No project contact emails are configured yet.</p>
            ) : null}
          </section>
        </>
      ) : null}

      {!loading && tab === "logs" && isAdmin ? (
        <section className="panel">
          <h2>Member activity log</h2>
          <p className="dashboard-subtle">Creates, role changes, password resets, and activation changes.</p>
          {(center?.auditLogs ?? []).length === 0 ? (
            <p>No member activity recorded yet.</p>
          ) : (
            <div className="layer-health-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Subject</th>
                    <th>Actor</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(center?.auditLogs ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{formatAuditAction(row.action)}</td>
                      <td>{row.subjectEmail ?? row.subjectName ?? row.entityId}</td>
                      <td>{row.actor?.email ?? "System"}</td>
                      <td>{row.metadata ? JSON.stringify(row.metadata) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </Shell>
  );
}
