import { AlertCategory, AlertSeverity } from "@prisma/client";
import { createAlert } from "../alerting.service";
import { prisma } from "../../lib/prisma";
import {
  MONITORING_ENTITY_SOURCE,
  type MonitoringConnectorMode,
  type NormalizedMonitoringSignal
} from "./monitoring-connector-types";

const mapSeverity = (value?: string): AlertSeverity => {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized.includes("CRITICAL") || normalized.includes("AVAILABILITY")) return AlertSeverity.CRITICAL;
  if (normalized.includes("HIGH") || normalized.includes("ERROR") || normalized.includes("ALERT")) {
    return AlertSeverity.HIGH;
  }
  if (normalized.includes("MEDIUM") || normalized.includes("WARN")) return AlertSeverity.MEDIUM;
  if (normalized.includes("LOW")) return AlertSeverity.LOW;
  if (normalized.includes("INFO")) return AlertSeverity.INFO;
  return AlertSeverity.MEDIUM;
};

const mapCategory = (mode: MonitoringConnectorMode, kind: string): AlertCategory => {
  if (mode === "APPLICATION_PERFORMANCE_CONNECTOR") return AlertCategory.PERFORMANCE;
  if (mode === "INFRASTRUCTURE_MONITORING_CONNECTOR") return AlertCategory.RELIABILITY;
  if (kind === "PROBLEM") return AlertCategory.RELIABILITY;
  return AlertCategory.AVAILABILITY;
};

export type CorrelatedMonitoringSignal = {
  alertId: string | null;
  created: boolean;
  suppressed: boolean;
  externalId: string;
  operationalEntityId: string | null;
};

/**
 * Correlate imported monitoring signals into OpsWatch alerts.
 * Deduplicates by sourceId + fingerprint. Never exposes vendor branding in alert text.
 */
export const correlateMonitoringSignals = async (input: {
  organizationId: string;
  projectId: string;
  connectionId: string;
  connectorMode: MonitoringConnectorMode;
  connectionName: string;
  signals: NormalizedMonitoringSignal[];
  entityIdByStableKey: Map<string, string>;
}): Promise<CorrelatedMonitoringSignal[]> => {
  const results: CorrelatedMonitoringSignal[] = [];

  for (const signal of input.signals) {
    const operationalEntityId = signal.entityStableKey
      ? input.entityIdByStableKey.get(signal.entityStableKey) ?? null
      : null;

    let serviceId: string | undefined;
    if (operationalEntityId) {
      const mapping = await prisma.legacyServiceEntityMapping.findFirst({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityId: operationalEntityId,
          status: "ACTIVE"
        },
        select: { legacyServiceId: true }
      });
      serviceId = mapping?.legacyServiceId;
    }

    const title = signal.title.slice(0, 240);
    const message = [
      `Monitoring source “${input.connectionName}” reported ${signal.kind.toLowerCase()}.`,
      signal.severity ? `Severity: ${signal.severity}.` : null,
      signal.entityStableKey ? `Entity key: ${signal.entityStableKey}.` : null,
      "Evidence imported without external vendor branding."
    ]
      .filter(Boolean)
      .join(" ");

    const created = await createAlert({
      projectId: input.projectId,
      serviceId,
      sourceType: MONITORING_ENTITY_SOURCE,
      sourceId: signal.externalId,
      severity: mapSeverity(signal.severity),
      category: mapCategory(input.connectorMode, signal.kind),
      title,
      message,
      dedupeBySourceId: true
    });

    if (created.alertId && operationalEntityId) {
      await prisma.alert.updateMany({
        where: {
          id: created.alertId,
          projectId: input.projectId,
          operationalEntityId: null
        },
        data: { operationalEntityId }
      });
    }

    results.push({
      alertId: created.alertId,
      created: created.created,
      suppressed: created.suppressed,
      externalId: signal.externalId,
      operationalEntityId
    });
  }

  return results;
};
