"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Header } from "../../components/layout/header";
import { Shell } from "../../components/layout/shell";
import { ConnectionRegistry } from "../../components/connections/connection-registry";
import { ConnectionWizard } from "../../components/connections/connection-wizard";
import { connectionFromRecord } from "../../components/connections/connection-form-state";
import type { ConnectionRecord, GuidedConnectionForm, ProjectOption } from "../../components/connections/types";
import { apiFetch } from "../../lib/api";
import { fetchSessionUser } from "../../lib/auth";

const safeReturnPath = (value: string | null): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

function ConnectionsPageContent() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const scopedProjectId = searchParams.get("projectId") || "";
  const edgeId = searchParams.get("edgeId");

  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(Boolean(scopedProjectId));
  const [editing, setEditing] = useState<{ id: string; form: GuidedConnectionForm; secretConfigured: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const scopedProjectName = useMemo(
    () => projects.find((row) => row.id === scopedProjectId)?.name ?? null,
    [projects, scopedProjectId]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectionRows, projectRows] = await Promise.all([
        apiFetch<ConnectionRecord[]>("/connections"),
        apiFetch<ProjectOption[]>("/projects")
      ]);
      setConnections(Array.isArray(connectionRows) ? connectionRows : []);
      setProjects(Array.isArray(projectRows) ? projectRows : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void fetchSessionUser().then((user) => {
      if (!user) {
        setIsAdmin(null);
        return;
      }
      setIsAdmin(user.role === "ADMIN");
    });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setShowWizard(true);
  };

  const openEdit = (connection: ConnectionRecord) => {
    setEditing({
      id: connection.id,
      form: connectionFromRecord(connection),
      secretConfigured: Boolean(connection.secretConfigured)
    });
    setShowWizard(true);
  };

  const closeWizard = () => {
    setShowWizard(false);
    setEditing(null);
  };

  const handleSaved = async () => {
    closeWizard();
    await load();
    if (returnTo) {
      window.location.assign(returnTo);
    }
  };

  const syncConnection = async (connectionId: string) => {
    setBusyId(connectionId);
    setError(null);
    try {
      await apiFetch(`/connections/${connectionId}/sync`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Monitoring sync failed");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const testConnection = async (connectionId: string) => {
    setBusyId(connectionId);
    setError(null);
    try {
      await apiFetch(`/connections/${connectionId}/test`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Connection test failed");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const disableConnection = async (connection: ConnectionRecord) => {
    setBusyId(connection.id);
    setError(null);
    try {
      const path = connection.isActive
        ? `/connections/${connection.id}/disable`
        : `/connections/${connection.id}/reactivate`;
      await apiFetch(path, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Failed to update connection");
    } finally {
      setBusyId(null);
    }
  };

  const rotateCredential = async (connection: ConnectionRecord, authSecret: string) => {
    setBusyId(connection.id);
    setError(null);
    try {
      await apiFetch(`/connections/${connection.id}/rotate-credential`, {
        method: "POST",
        body: JSON.stringify({ authSecret })
      });
      await load();
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : "Failed to rotate credential");
    } finally {
      setBusyId(null);
    }
  };

  const deleteConnection = async (connection: ConnectionRecord) => {
    if (!window.confirm(`Delete connection “${connection.name}”? This cannot be undone.`)) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await apiFetch(`/connections/${connection.id}`, { method: "DELETE" });
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete connection");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Shell>
      <Header
        title="Monitoring connections"
        description="Connect monitoring sources with secure credentials, connection testing, and scheduled synchronization."
        actions={
          <button type="button" className="primary-button" onClick={openCreate}>
            + Connect monitoring source
          </button>
        }
      />
      {returnTo ? (
        <aside className="notice-panel" role="status" data-testid="connections-return-banner">
          <strong>Return to topology</strong>
          <p>
            {scopedProjectName
              ? `Configuring connections for ${scopedProjectName}${edgeId ? ` · relationship ${edgeId}` : ""}.`
              : "You came here from a topology relationship that needs a provider."}{" "}
            After saving, OpsWatch can send you back to finish the Fix with automation journey.
          </p>
          <Link className="secondary-button" href={returnTo} data-testid="connections-return-link">
            ← Back to topology
          </Link>
        </aside>
      ) : null}
      {error ? (
        <section className="panel error-panel" role="alert">
          {error}
        </section>
      ) : null}
      {showWizard ? (
        <ConnectionWizard
          key={editing?.id ?? `create-${scopedProjectId || "new"}`}
          projects={projects}
          initialApplicationId={editing ? editing.form.applicationId : scopedProjectId}
          initialForm={editing?.form}
          editingConnectionId={editing?.id ?? null}
          editingSecretConfigured={editing?.secretConfigured ?? false}
          onCancel={closeWizard}
          onSaved={handleSaved}
        />
      ) : null}
      <ConnectionRegistry
        connections={connections}
        loading={loading}
        busyId={busyId}
        isAdmin={isAdmin}
        onAdd={openCreate}
        onTest={(id) => void testConnection(id)}
        onSync={(id) => void syncConnection(id)}
        onEdit={openEdit}
        onDisable={(row) => void disableConnection(row)}
        onRotate={(row, secret) => void rotateCredential(row, secret)}
        onDelete={(row) => void deleteConnection(row)}
      />
      <section className="panel connection-related-links" aria-label="Related surfaces">
        <h2>Related surfaces</h2>
        <p className="dashboard-subtle">
          Operational topology and change history live with each application, not on this page.
        </p>
        <div className="connection-related-links__grid">
          <Link className="quick-link-card" href="/projects">
            <strong>Applications</strong>
            <span>Open an application overview for connection status and topology.</span>
          </Link>
          {scopedProjectId ? (
            <Link className="quick-link-card" href={`/projects/${scopedProjectId}/topology`}>
              <strong>Application topology</strong>
              <span>View the dependency graph and live operations for this app.</span>
            </Link>
          ) : (
            <Link className="quick-link-card" href="/projects">
              <strong>Topology</strong>
              <span>Choose an application, then open its topology workspace.</span>
            </Link>
          )}
        </div>
      </section>
    </Shell>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Header title="Connections" />
          <section className="panel">Loading connections...</section>
        </Shell>
      }
    >
      <ConnectionsPageContent />
    </Suspense>
  );
}
