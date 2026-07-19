export const isOtelIngestionEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_INGESTION_ENABLED === "true";

export const isOtelTopologyDiscoveryEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED === "true";

export const isOtelAlertGenerationEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED === "true";

export const isOtelIncidentCorrelationEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED === "true";

export type OtelFeatureFlags = {
  ingestion: boolean;
  topologyDiscovery: boolean;
  alertGeneration: boolean;
  incidentCorrelation: boolean;
};

export const getOtelFeatureFlags = (): OtelFeatureFlags => ({
  ingestion: isOtelIngestionEnabled(),
  topologyDiscovery: isOtelTopologyDiscoveryEnabled(),
  alertGeneration: isOtelAlertGenerationEnabled(),
  incidentCorrelation: isOtelIncidentCorrelationEnabled()
});

export const otelPayloadLimitBytes = (): number => {
  const configured = Number(process.env.OPSWATCH_OTEL_MAX_PAYLOAD_BYTES ?? 524_288);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 1_048_576) : 524_288;
};

export const otelMaxSignalsPerBatch = (): number => {
  const configured = Number(process.env.OPSWATCH_OTEL_MAX_SIGNALS ?? 1_000);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 5_000) : 1_000;
};

export const otelInstanceCardinalityCap = (): number => {
  const configured = Number(process.env.OPSWATCH_OTEL_INSTANCE_CARDINALITY_CAP ?? 50);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 500) : 50;
};

export const otelDependencyEvidenceThreshold = (): number => {
  const configured = Number(process.env.OPSWATCH_OTEL_DEPENDENCY_EVIDENCE_THRESHOLD ?? 3);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 100) : 3;
};
