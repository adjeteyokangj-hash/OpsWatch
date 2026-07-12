"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectActivityFeed } from "../../../components/projects/project-activity-feed";
import { ProjectHealthCard, ProjectSnapshotPanel } from "../../../components/projects/project-health-card";
import { ProjectWorkspaceShell } from "../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../hooks/use-project-workspace";

const signalAgeLabel = (receivedAt?: string | null): string => {
	if (!receivedAt) return "Awaiting first check";
	const ageMs = Date.now() - new Date(receivedAt).getTime();
	const ageMin = Math.floor(ageMs / 60000);
	if (ageMin < 2) return "Just now";
	if (ageMin < 60) return `${ageMin} min ago`;
	const ageHours = Math.floor(ageMin / 60);
	if (ageHours < 24) return `${ageHours} h ago`;
	return `${Math.floor(ageHours / 24)} d ago`;
};

const latestCheckAt = (project: any): string | null => {
	const services = Array.isArray(project?.services) ? project.services : [];
	let latest: string | null = null;

	for (const service of services) {
		const checks = Array.isArray(service?.checks) ? service.checks : Array.isArray(service?.Check) ? service.Check : [];
		for (const check of checks) {
			const result = Array.isArray(check?.checkResults)
				? check.checkResults[0]
				: Array.isArray(check?.CheckResult)
					? check.CheckResult[0]
					: null;
			const checkedAt = result?.checkedAt ? String(result.checkedAt) : null;
			if (!checkedAt) continue;
			if (!latest || new Date(checkedAt).getTime() > new Date(latest).getTime()) {
				latest = checkedAt;
			}
		}
	}

	return latest;
};

export default function ProjectDetailPage() {
	const params = useParams<{ projectId: string }>();
	const { project, loading, error } = useProjectWorkspace(params.projectId);

	if (!loading && !project) {
		return (
			<ProjectWorkspaceShell
				projectId={params.projectId}
				title="Project"
				error={error}
				loading={false}
			>
				<section className="panel workspace-empty-state">Project not found.</section>
			</ProjectWorkspaceShell>
		);
	}

	const openAlerts = (project?.alerts ?? []).filter((alert: any) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED");
	const unresolvedIncidents = (project?.incidents ?? []).filter((incident: any) => incident.status !== "RESOLVED");
	const resolvedIncidents = (project?.incidents ?? []).filter((incident: any) => incident.status === "RESOLVED");
	const latestSignal = project?.lastSignalAt ?? project?.lastCompletedCheckAt ?? project?.heartbeats?.[0]?.receivedAt ?? latestCheckAt(project);
	const healthLabel = project?.healthDisplayLabel ?? (project?.status === "UNKNOWN" ? "Awaiting first check" : project?.status);
	const liveRisk =
		project?.status === "UNKNOWN"
			? "No confirmed operational status yet"
			: `${openAlerts.length} open alerts and ${unresolvedIncidents.length} unresolved incidents`;
	const latestSignalLabel =
		project?.status === "UNKNOWN" && !project?.lastCompletedCheckAt
			? "No completed monitoring checks"
			: signalAgeLabel(latestSignal);

	return (
		<ProjectWorkspaceShell
			projectId={params.projectId}
			title={project?.name ?? "Project"}
			subtitle="Project overview, live risk, and quick navigation."
			project={project}
			loading={loading}
			error={error}
		>
			{project ? (
				<>
					<ProjectSnapshotPanel
						healthLabel={healthLabel}
						healthReason={project.healthReason}
						liveRisk={liveRisk}
						latestSignalLabel={latestSignalLabel}
						affectedModules={project.affectedModules}
						affectedWorkflows={project.affectedWorkflows}
						affectedComponents={project.affectedComponents}
					/>
					<section className="metric-strip">
						<ProjectHealthCard title="Status" value={healthLabel} href={`/projects/${project.id}/checks`} />
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
						<ProjectHealthCard title="Latest Signal" value={latestSignalLabel} href={`/projects/${project.id}/checks`} />
					</section>
					<section className="panel quick-links-panel">
						<h2>Quick links</h2>
						<div className="quick-link-grid">
							<Link className="quick-link-card" href={`/projects/${project.id}/monitored-areas`}>
								<strong>Monitored areas</strong>
								<span>Layer health across app, modules, workflows, and components.</span>
							</Link>
							<Link className="quick-link-card" href={`/projects/${project.id}/topology`}>
								<strong>Service map</strong>
								<span>Dependency graph and topology for this application.</span>
							</Link>
							<Link className="quick-link-card" href={`/projects/${project.id}/billing`}>
								<strong>Billing</strong>
								<span>Plan, pricing, and usage limits for this project.</span>
							</Link>
							<Link className="quick-link-card" href={`/projects/${project.id}/contacts`}>
								<strong>Contacts</strong>
								<span>Operational owners and notification contacts.</span>
							</Link>
						</div>
					</section>
					<ProjectActivityFeed
						title="Open alerts"
						emptyMessage="No open alerts for this project."
						emptyHref={`/alerts?projectId=${project.id}`}
						emptyHrefLabel="View alert history"
						alerts={openAlerts}
					/>
					<ProjectActivityFeed
						title="Active incidents"
						emptyMessage="No active incidents for this project."
						emptyHref={`/incidents?projectId=${project.id}`}
						emptyHrefLabel="View incident history"
						incidents={unresolvedIncidents}
					/>
					{resolvedIncidents.length > 0 ? (
						<p className="dashboard-subtle workspace-footnote">Resolved incidents are secondary ({resolvedIncidents.length}).</p>
					) : null}
				</>
			) : null}
		</ProjectWorkspaceShell>
	);
}
