import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const CHANGE_LEDGER_KINDS = [
  "DEPLOYMENT",
  "CONFIGURATION",
  "TOPOLOGY",
  "AUTOMATION",
  "MIGRATION",
  "CHANGE",
  "CONNECTION_VALIDATION"
] as const;

export type ChangeLedgerKind = (typeof CHANGE_LEDGER_KINDS)[number];

export const isChangeLedgerKind = (value: unknown): value is ChangeLedgerKind =>
  typeof value === "string" && (CHANGE_LEDGER_KINDS as readonly string[]).includes(value);

export type CreateLedgerEntryInput = {
  organizationId: string;
  projectId?: string | null;
  serviceId?: string | null;
  incidentId?: string | null;
  connectionId?: string | null;
  kind: ChangeLedgerKind;
  summary: string;
  actorType?: string | null;
  actor?: string | null;
  source: string;
  externalId?: string | null;
  evidence?: Record<string, unknown> | null;
  occurredAt?: Date;
};

export const createChangeLedgerEntry = async (input: CreateLedgerEntryInput) =>
  prisma.changeLedgerEntry.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      serviceId: input.serviceId ?? null,
      incidentId: input.incidentId ?? null,
      connectionId: input.connectionId ?? null,
      kind: input.kind,
      summary: input.summary,
      actorType: input.actorType ?? null,
      actor: input.actor ?? null,
      source: input.source,
      externalId: input.externalId ?? null,
      ...(input.evidence ? { evidenceJson: input.evidence as Prisma.InputJsonValue } : {}),
      occurredAt: input.occurredAt ?? new Date()
    }
  });

export const toChangeLedgerDto = (row: any) => ({
  id: row.id,
  kind: row.kind,
  summary: row.summary,
  actorType: row.actorType,
  actor: row.actor,
  source: row.source,
  externalId: row.externalId,
  evidence: row.evidenceJson ?? null,
  occurredAt: row.occurredAt.toISOString(),
  project: row.Project ? { id: row.Project.id, name: row.Project.name } : null,
  service: row.Service ? { id: row.Service.id, name: row.Service.name } : null,
  connection: row.Connection ? { id: row.Connection.id, name: row.Connection.name } : null
});
