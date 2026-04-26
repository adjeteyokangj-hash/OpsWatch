"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";
import { ProjectHealthCard } from "../../../components/projects/project-health-card";
import { ServiceList } from "../../../components/projects/service-list";

const heartbeatAgeLabel = (receivedAt?: string | null): string => {
	if (!receivedAt) return "No heartbeat";
	const ageMs = Date.now() - new Date(receivedAt).getTime();
	const ageMin = Math.floor(ageMs / 60000);
	if (ageMin < 2) return "Just now";
	if (ageMin < 60) return `${ageMin} min ago`;
	const ageHours = Math.floor(ageMin / 60);
	if (ageHours < 24) return `${ageHours} h ago`;
	return `${Math.floor(ageHours / 24)} d ago`;
};

const normalizeProject = (row: any) => ({
	...row,
	services: row.services ?? row.Service ?? [],
	alerts: row.alerts ?? row.Alert ?? [],
	incidents: row.incidents ?? row.Incident ?? [],
	heartbeats: row.heartbeats ?? row.Heartbeat ?? [],
	events: row.events ?? row.Event ?? [],
	integrations: row.integrations ?? row.ProjectIntegration ?? [],
	notificationChannels: row.notificationChannels ?? row.NotificationChannel ?? []
});

export default function ProjectDetailPage() {
	const params = useParams<{ projectId: string }>();
	const router = useRouter();
	const [project, setProject] = useState<any | null>(null);
	const [loading, setLoading] = useState(true);
	const [deleting, setDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [confirmName, setConfirmName] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!params.projectId) {
			return;
		}

		const load = async () => {
			setLoading(true);
			setError(null);
			try {
				const row = await apiFetch<any>(`/projects/${params.projectId}`);
				setProject(normalizeProject(row));
			} catch (err: any) {
				setError(err?.message || "Failed to load project");
				setProject(null);
			} finally {
				setLoading(false);
			}
		};

		void load();
	}, [params.projectId]);

	const handleDeleteProject = async () => {
		if (!project || confirmName !== project.name) {
			setError(`Type ${project?.name || "the project name"} to confirm deletion.`);
			return;
		}
		setDeleting(true);
		setError(null);
		try {
			await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
			router.push("/projects");
		} catch (err: any) {
			setError(err?.message || "Failed to delete project");
		} finally {
			setDeleting(false);
		}
	};

	if (loading) {
		return (
			<Shell>
				<Header title="Project" />
				<section className="panel">Loading...</section>
			</Shell>
		);
	}

	if (!project) {
		return (
			<Shell>
				<Header title="Project" />
				{error ? <section className="panel error-panel">{error}</section> : null}
				<section className="panel">Project not found.</section>
			</Shell>
		);
	}

	const openAlerts = project.alerts.filter((alert: any) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED");
	const unresolvedIncidents = project.incidents.filter((incident: any) => incident.status !== "RESOLVED");
	const resolvedIncidents = project.incidents.filter((incident: any) => incident.status === "RESOLVED");
	const latestHeartbeat = project.heartbeats?.[0]?.receivedAt ?? null;

	return (
		<Shell>
			<Header title={`Project: ${project.name}`} />
			<section className="panel">
				<nav className="pill-row">
					<Link className="pill" href={`/projects/${project.id}`}>Overview</Link>
					<Link className="pill" href={`/projects/${project.id}?tab=services`}>Services</Link>
					<Link className="pill" href={`/projects/${project.id}/checks`}>Checks</Link>
					<Link className="pill" href={`/alerts?projectId=${project.id}`}>Alerts</Link>
					<Link className="pill" href={`/incidents?projectId=${project.id}`}>Incidents</Link>
					<Link className="pill" href={`/projects/${project.id}/integrations/webhook`}>Integrations</Link>
					<Link className="pill" href="/auto-run-policy">Policies</Link>
				</nav>
			</section>
			<section className="panel">
				<h2>Operational Snapshot</h2>
				<ul className="dashboard-list">
					<li>
						<strong>Current status:</strong> {project.status}.
					</li>
					<li>
						<strong>Live risk:</strong> {openAlerts.length} open alerts and {unresolvedIncidents.length} unresolved incidents.
					</li>
					<li>
						<strong>Latest heartbeat:</strong> {heartbeatAgeLabel(latestHeartbeat)}.
					</li>
				</ul>
			</section>
			<section className="four-col">
				<ProjectHealthCard title="Status" value={project.status} href={`/projects/${project.id}/checks`} />
				<ProjectHealthCard
					title="Open Alerts"
					value={String(openAlerts.length)}
					href={`/alerts?projectId=${project.id}&status=OPEN`}
				/>
				<ProjectHealthCard
					title="Open Incidents"
					value={String(unresolvedIncidents.length)}
					href={`/incidents?projectId=${project.id}&onlyUnresolved=true`}
				/>
				<ProjectHealthCard
					title="Latest Heartbeat"
					value={heartbeatAgeLabel(latestHeartbeat)}
					href={`/projects/${project.id}/activity`}
				/>
			</section>
			<section className="panel">
				<h2>Services</h2>
				<ServiceList rows={project.services} projectId={project.id} />
			</section>
			<section className="panel">
				<h2>Open Alerts</h2>
				{openAlerts.length === 0 ? (
					<p>No open alerts. <Link href={`/alerts?projectId=${project.id}`}>View alert history</Link>.</p>
				) : (
					<ul className="dashboard-list">
						{openAlerts.map((alert: any) => (
							<li key={alert.id}>
								<span className={`severity ${String(alert.severity || "LOW").toLowerCase()}`}>{alert.severity}</span>{" "}
								<Link href={`/alerts/${alert.id}`}>{alert.title}</Link>
								<div className="dashboard-subtle">{alert.status} · Last seen {new Date(alert.lastSeenAt).toLocaleString()}</div>
							</li>
						))}
					</ul>
				)}
			</section>
			<section className="panel">
				<h2>Active Incidents</h2>
				{unresolvedIncidents.length === 0 ? (
					<p>No active incidents. <Link href={`/incidents?projectId=${project.id}`}>View incident history</Link>.</p>
				) : (
					<ul className="dashboard-list">
						{unresolvedIncidents.map((incident: any) => (
							<li key={incident.id}>
								<span className={`incident-chip ${incident.status === "RESOLVED" ? "resolved" : "active"}`}>{incident.status}</span>{" "}
								<Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
								<div className="dashboard-subtle">{incident.severity} · Opened {new Date(incident.openedAt).toLocaleString()}</div>
							</li>
						))}
					</ul>
				)}
				{resolvedIncidents.length > 0 ? <p className="dashboard-subtle">Resolved incidents are secondary ({resolvedIncidents.length}).</p> : null}
			</section>
			<section className="panel danger-zone">
				<div className="section-head">
					<div>
						<h2>Delete project</h2>
						<p>Remove this project and its services, checks, results, alerts, incidents, events, and heartbeats.</p>
					</div>
					<button type="button" className="danger-button solid-danger-button" onClick={() => setShowDeleteConfirm(true)}>
						Delete project
					</button>
				</div>
			</section>
			{showDeleteConfirm ? (
				<div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete project">
					<section className="modal-panel" style={{ maxWidth: "520px" }}>
						<div className="section-head">
							<div>
								<h2>Delete {project.name}?</h2>
								<p>This cannot be undone. Type the project name to confirm.</p>
							</div>
							<button
								type="button"
								className="secondary-button"
								onClick={() => {
									setShowDeleteConfirm(false);
									setConfirmName("");
								}}
							>
								Cancel
							</button>
						</div>
						<div className="stack-form">
							<label>
								Project name
								<input
									value={confirmName}
									onChange={(event) => setConfirmName(event.target.value)}
									placeholder={project.name}
								/>
							</label>
							<button
								type="button"
								className="danger-button solid-danger-button"
								disabled={deleting || confirmName !== project.name}
								onClick={() => void handleDeleteProject()}
							>
								{deleting ? "Deleting..." : "Delete permanently"}
							</button>
						</div>
					</section>
				</div>
			) : null}
		</Shell>
	);
}
