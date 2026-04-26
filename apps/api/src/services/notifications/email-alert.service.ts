import nodemailer from "nodemailer";
import type { Alert, NotificationChannel, Project, Service } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

type AlertWithRelations = Alert & {
	Project: Project;
	Service: Service | null;
};

let transporter: nodemailer.Transporter | null | undefined;

const getTransporter = (): nodemailer.Transporter | null => {
	if (transporter !== undefined) {
		return transporter;
	}

	if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
		logger.warn("SMTP credentials missing; email notifications are disabled");
		transporter = null;
		return transporter;
	}

	transporter = nodemailer.createTransport({
		host: env.smtpHost,
		port: env.smtpPort,
		secure: env.smtpPort === 465,
		auth: {
			user: env.smtpUser,
			pass: env.smtpPass
		}
	});

	return transporter;
};

const escapeHtml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

export const sendEmailAlert = async (
	channel: NotificationChannel,
	alert: AlertWithRelations,
	reason: string
): Promise<void> => {
	const mailer = getTransporter();
	if (!mailer) {
		return;
	}

	await mailer.sendMail({
		from: env.smtpFrom,
		to: channel.target,
		subject: `[OpsWatch] ${alert.Project.name} ${alert.severity} ${alert.title}`,
		text: [
			`Notification: ${reason}`,
			`Project: ${alert.Project.name}`,
			`Service: ${alert.Service?.name || "-"}`,
			`Severity: ${alert.severity}`,
			`Status: ${alert.status}`,
			`Title: ${alert.title}`,
			`Message: ${alert.message}`,
			`Seen: ${alert.lastSeenAt.toISOString()}`
		].join("\n"),
		html: `
			<h2>OpsWatch alert ${escapeHtml(reason)}</h2>
			<p><strong>Project:</strong> ${escapeHtml(alert.Project.name)}</p>
			<p><strong>Service:</strong> ${escapeHtml(alert.Service?.name || "-")}</p>
			<p><strong>Severity:</strong> ${escapeHtml(alert.severity)}</p>
			<p><strong>Status:</strong> ${escapeHtml(alert.status)}</p>
			<p><strong>Title:</strong> ${escapeHtml(alert.title)}</p>
			<p><strong>Message:</strong> ${escapeHtml(alert.message)}</p>
			<p><strong>Seen:</strong> ${escapeHtml(alert.lastSeenAt.toISOString())}</p>
		`
	});
};
export {};
