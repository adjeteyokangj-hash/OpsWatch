import nodemailer from "nodemailer";
import type { Alert, NotificationChannel, Project, Service } from "@prisma/client";
import { logger } from "../../lib/logger";

type AlertWithRelations = Alert & {
  Project: Project;
  Service: Service | null;
};

let transporter: nodemailer.Transporter | null | undefined;

const getTransporter = (): nodemailer.Transporter | null => {
  if (transporter !== undefined) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass) {
    logger.warn("SMTP credentials missing; email notifications are disabled");
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return transporter;
};

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
    from: process.env.SMTP_FROM || "alerts@opswatch.local",
    to: channel.target,
    subject: `[OpsWatch] ${alert.Project.name} ${alert.severity} ${alert.title}`,
    text: [
      `Notification: ${reason}`,
      `Project: ${alert.Project.name}`,
      `Service: ${alert.Service?.name || "-"}`,
      `Severity: ${alert.severity}`,
      `Status: ${alert.status}`,
      `Title: ${alert.title}`,
      `Message: ${alert.message}`
    ].join("\n")
  });
};