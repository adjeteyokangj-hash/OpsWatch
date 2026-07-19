import {
  isOtelIngestionEnabled,
  otelPayloadLimitBytes,
  getOtelFeatureFlags
} from "./otel/otel-feature-flags";
import { redactOtelAttributes } from "./otel/otel-redaction";
import {
  parseOtelBridgePayload,
  type OtelBridgePayload,
  type OtelSignalKind
} from "./otel/otel-normalize";
import {
  ingestOtelBridgePayload,
  type OtelConnection,
  type OtelIngestResult
} from "./otel/otel-ingest.service";

export type { OtelBridgePayload, OtelSignalKind, OtelConnection, OtelIngestResult };
export {
  isOtelIngestionEnabled,
  otelPayloadLimitBytes,
  getOtelFeatureFlags,
  redactOtelAttributes,
  parseOtelBridgePayload,
  ingestOtelBridgePayload
};
