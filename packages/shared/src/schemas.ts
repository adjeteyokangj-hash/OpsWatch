import { z } from "zod";
import { AlertSeverity, EventType, ProjectStatus } from "./enums";

export const heartbeatSchema = z.object({
	projectSlug: z.string().min(1),
	environment: z.string().min(1),
	status: z.nativeEnum(ProjectStatus),
	commitSha: z.string().optional(),
	appVersion: z.string().optional(),
	message: z.string().optional(),
	payload: z.record(z.unknown()).optional()
});

export const eventSchema = z.object({
	projectSlug: z.string().min(1),
	type: z.nativeEnum(EventType),
	severity: z.nativeEnum(AlertSeverity),
	source: z.string().min(1),
	message: z.string().min(1),
	serviceId: z.string().uuid().optional(),
	fingerprint: z.string().optional(),
	payload: z.record(z.unknown()).optional()
});
