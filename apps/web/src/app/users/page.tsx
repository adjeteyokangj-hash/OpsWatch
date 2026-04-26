"use client";

import { FormEvent, useEffect, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { getAuthClaims } from "../../lib/auth";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer"
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", role: "MEMBER" });
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  useEffect(() => {
    const claims = getAuthClaims();
    const email = (claims?.email as string | undefined) || (claims?.sub as string | undefined) || null;
    setCurrentEmail(email);
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<UserRow[]>("/users");
      setUsers(rows);
    } catch (err: any) {
      setError(err?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch("/auth/invite", {
        method: "POST",
        body: JSON.stringify(invite)
      });
      setSuccessMsg(`Invited ${invite.email} as ${invite.role}`);
      setInvite({ name: "", email: "", role: "MEMBER" });
      setShowInvite(false);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to invite user");
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (userId: string, role: string) => {
    setError(null);
    try {
      const updated = await apiFetch<UserRow>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err: any) {
      setError(err?.message || "Failed to update role");
    }
  };

  const deactivateUser = async (userId: string) => {
    setError(null);
    const user = users.find((row) => row.id === userId);
    if (!user) return;
    if (currentEmail && user.email === currentEmail) {
      setError("You cannot deactivate your own account. Transfer ownership first.");
      return;
    }
    if (!window.confirm(`Deactivate ${user.email}?`)) {
      return;
    }
    try {
      await apiFetch(`/users/${userId}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to deactivate user");
    }
  };

  return (
    <Shell>
      <Header title="Team" />
      {error ? <section className="panel error-panel">{error}</section> : null}
      {successMsg ? <section className="panel success-panel">{successMsg}</section> : null}

      {showInvite ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Invite team member</h2>
              <p>They will be added to your organization with the selected role.</p>
            </div>
            <button className="secondary-button" onClick={() => setShowInvite(false)}>Cancel</button>
          </div>
          <form className="stack-form" onSubmit={(e) => void handleInvite(e)}>
            <label>
              Name
              <input
                value={invite.name}
                onChange={(e) => setInvite((i) => ({ ...i, name: e.target.value }))}
                required
                placeholder="Jane Smith"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={invite.email}
                onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))}
                required
                placeholder="jane@example.com"
              />
            </label>
            <label>
              Role
              <select value={invite.role} onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
                <option value="VIEWER">Viewer (read-only)</option>
              </select>
            </label>
            <button type="submit" disabled={saving}>{saving ? "Sending…" : "Send invitation"}</button>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Team members</h2>
            <p>All users in your organization.</p>
          </div>
          {!showInvite ? (
            <button className="primary-button" onClick={() => setShowInvite(true)}>+ Invite member</button>
          ) : null}
        </div>

        {loading ? (
          <p>Loading team...</p>
        ) : users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong></td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      aria-label={`Role for ${user.email}`}
                      value={user.role}
                      onChange={(e) => void updateRole(user.id, e.target.value)}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MEMBER">Member</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </td>
                  <td>
                    <span className={`result-pill ${user.isActive ? "pass" : "fail"}`}>
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>
                    {user.isActive ? (
                      <button
                        className="danger-button"
                        onClick={() => void deactivateUser(user.id)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <span className="table-subtle">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
