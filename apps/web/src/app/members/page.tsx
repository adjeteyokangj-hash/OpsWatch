"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { refreshAuthSession } from "../../lib/auth";
import { generatePassword } from "../../lib/password-generator";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isPlatformSuperAdmin?: boolean;
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

const platformSuperAdminError = (err: unknown): string => {
  const message = String((err as { message?: string })?.message || "");
  if (/migrations are incomplete|isPlatformSuperAdmin|Failed to ensure/i.test(message)) {
    return "Cannot update Platform Super Admin yet — database migrations are incomplete. Ask an operator to run prisma migrate deploy with the Supabase session pooler DIRECT_URL, then retry.";
  }
  return message || "Failed to update platform Super Admin";
};

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
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    role: "MEMBER",
    password: "",
    alsoGrantPlatformSuperAdmin: false
  });
  const [showGeneratedPassword, setShowGeneratedPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = useState(false);

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
    void refreshAuthSession().then((user) => {
      const admin = user?.role === "ADMIN";
      setCurrentUserId(user?.id ?? null);
      setIsAdmin(admin);
      setIsPlatformSuperAdmin(Boolean(user?.isPlatformSuperAdmin));
      void load(admin);
    });
  }, []);

  const reload = async () => load(isAdmin);

  const users = useMemo(() => center?.users ?? [], [center?.users]);
  const activeAdminCount = center?.activeAdminCount ?? 0;

  const isLastActiveAdmin = useCallback(
    (user: UserRow): boolean =>
      user.role === "ADMIN" && user.isActive && activeAdminCount <= 1,
    [activeAdminCount]
  );

  const protectedAdmin = useMemo(
    () => users.find((user) => isLastActiveAdmin(user)) ?? null,
    [users, isLastActiveAdmin]
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const { alsoGrantPlatformSuperAdmin, ...inviteBody } = createForm;
      const created = await apiFetch<UserRow & { inviteOutcome?: "created" | "reattached" | "already_in_org" }>(
        "/auth/invite",
        {
          method: "POST",
          body: JSON.stringify(inviteBody)
        }
      );
      let grantedPlatformSuperAdmin = false;
      let grantWarning: string | null = null;
      if (alsoGrantPlatformSuperAdmin && isPlatformSuperAdmin && created.id) {
        try {
          await apiFetch(`/users/${created.id}/platform-super-admin`, {
            method: "POST",
            body: JSON.stringify({ enabled: true })
          });
          grantedPlatformSuperAdmin = true;
        } catch (grantErr: unknown) {
          grantWarning = platformSuperAdminError(grantErr);
        }
      }
      const successByOutcome: Record<string, string> = {
        already_in_org: `${createForm.email} is already a member of this organization.`,
        reattached: `${createForm.email} was added to this organization. Share the initial password securely.`,
        created: `Created ${createForm.email}. Share the initial password securely.`
      };
      const baseMsg =
        successByOutcome[created.inviteOutcome ?? "created"] ?? successByOutcome.created ?? "Member saved.";
      setSuccessMsg(
        grantedPlatformSuperAdmin
          ? `${baseMsg} Also granted Platform Super Admin (all orgs).`
          : baseMsg
      );
      if (grantWarning) {
        setError(
          `${grantWarning} The member was created — use Make Platform Super Admin in Actions once migrations are ready.`
        );
      }
      setCreateForm({
        name: "",
        email: "",
        role: "MEMBER",
        password: "",
        alsoGrantPlatformSuperAdmin: false
      });
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

  const togglePlatformSuperAdmin = async (user: UserRow) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/users/${user.id}/platform-super-admin`, {
        method: "POST",
        body: JSON.stringify({ enabled: !user.isPlatformSuperAdmin })
      });
      setSuccessMsg(
        user.isPlatformSuperAdmin
          ? `Revoked Platform Super Admin from ${user.email}.`
          : `Granted Platform Super Admin to ${user.email}.`
      );
      await reload();
    } catch (err: unknown) {
      setError(platformSuperAdminError(err));
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
          <p className="dashboard-subtle">
            <strong>Organization role</strong> (Admin / Member / Viewer) controls access inside this org only.{" "}
            <strong>Platform Super Admin (all orgs)</strong> is separate — grant it below or from Actions. Email
            allowlist bootstrap: <code>admin@okanggroup.com</code>.
          </p>
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
              Organization role
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
            {isPlatformSuperAdmin ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={createForm.alsoGrantPlatformSuperAdmin}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      alsoGrantPlatformSuperAdmin: event.target.checked
                    }))
                  }
                />
                Also grant Platform Super Admin (all orgs)
              </label>
            ) : null}
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
          {isAdmin && !isPlatformSuperAdmin ? (
            <p className="dashboard-subtle">
              Platform Super Admin is not an organization role. Sign in as{" "}
              <code>admin@okanggroup.com</code> (or another Super Admin), then use{" "}
              <strong>Make Super Admin</strong> in the Actions column after the member exists (usually as Admin).
            </p>
          ) : null}
          {isAdmin && isPlatformSuperAdmin ? (
            <p className="dashboard-subtle">
              You can grant or revoke <strong>platform Super Admin</strong> from Actions. Create member only sets an
              organization role (Admin, Member, …) — grant Super Admin after the account exists.
            </p>
          ) : null}
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
                      {user.isPlatformSuperAdmin ? (
                        <div className="member-role-cell">
                          <span className="result-pill pass" title="Platform Super Admin (all orgs)">
                            Platform Super Admin
                          </span>
                          {isAdmin ? (
                            <select
                              aria-label={`Organization role for ${user.email}`}
                              value={user.role}
                              disabled={lastAdmin}
                              onChange={(event) => void updateRole(user.id, event.target.value)}
                            >
                              {ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  Org: {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="dashboard-subtle">
                              Org: {ROLE_LABELS[user.role] ?? user.role}
                            </span>
                          )}
                        </div>
                      ) : isAdmin ? (
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
                        {isPlatformSuperAdmin ? (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={user.id === currentUserId && user.isPlatformSuperAdmin}
                            title={
                              user.id === currentUserId && user.isPlatformSuperAdmin
                                ? "You cannot revoke your own platform Super Admin access."
                                : user.isPlatformSuperAdmin
                                  ? "Revoke platform Super Admin flag"
                                  : "Grant platform Super Admin (separate from organization role)"
                            }
                            onClick={() => void togglePlatformSuperAdmin(user)}
                            data-action="api"
                            data-endpoint="/users/:id/platform-super-admin"
                          >
                            {user.isPlatformSuperAdmin
                              ? "Revoke Platform Super Admin"
                              : "Make Platform Super Admin"}
                          </button>
                        ) : null}
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
