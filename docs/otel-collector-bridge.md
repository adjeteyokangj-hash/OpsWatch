# OpenTelemetry Collector bridge

OpsWatch does not run an OTLP receiver. An official OpenTelemetry Collector receives OTLP from workloads and exports OTLP/HTTP JSON to OpsWatch's authenticated internal bridge:

`Collector → POST /api/internal/otel/v1/bridge/connections/{connectionId}`

The bridge is disabled by default. Set `OPSWATCH_OTEL_INGESTION_ENABLED=true` only after creating an active `OTEL_COLLECTOR` connection with an `env://...` credential reference. The collector uses that credential as `X-OpsWatch-Connection-Key`; use TLS and a network path that restricts the internal endpoint. The TypeScript reference client additionally supports signed HMAC requests with timestamp and nonce headers.

## Contract and behavior

The bridge accepts OTLP/HTTP JSON emitted by the Collector `http` exporter. It normalizes metrics, logs, and spans into factual operational observations and timeline events, creates or refreshes a `SERVICE` operational entity from `service.name` and `deployment.environment`, and preserves trace/span IDs for correlation.

- Only allowed resource and signal attributes are stored. Keys resembling credentials, tokens, cookies, sessions, or personal/contact data are dropped.
- Default payload limit is 512 KiB (`OPSWATCH_OTEL_MAX_PAYLOAD_BYTES`, capped at 1 MiB); batches are limited to 1,000 normalized signals.
- Static collector credentials use a body digest as a 24-hour replay key. HMAC clients use their nonce. A replay returns `409`; a collector can treat it as already accepted.
- Processing is synchronous. There is no queue or background retry/dead-letter worker in this phase. Validation, authentication, replay, and contract rejections are logged and auditable for a known connection.
- Telemetry is factual only. This phase creates no predictions, inferred relationships, alerts, or remediation.

## Generic professional-services document platform sample

Create an `OTEL_COLLECTOR` connection in Connections, assign it to the document platform project, set `authMethod` to `API_KEY`, set the expected `service.name` to `document-api`, and reference `env://DOCUMENT_PLATFORM_OTEL_BRIDGE_KEY`. The bridge requires both resource `service.name` and `deployment.environment` to match this connection, so credentials cannot create entities for another declared service or environment. Place the resolved value in the collector environment as `OPSWATCH_CONNECTION_KEY`.

Use [examples/otel-collector/document-platform.yaml](../examples/otel-collector/document-platform.yaml) with the Docker composition in [examples/otel-collector/docker-compose.dev.yml](../examples/otel-collector/docker-compose.dev.yml).

The example is deliberately generic: it models a document API, asynchronous document processing, and a client portal. It has no Noble, courier, or organization-specific assumptions.
Configure the workload resource, for example `OTEL_RESOURCE_ATTRIBUTES=service.name=document-api,deployment.environment=staging`; both values are required by the bridge identity check.

## TypeScript bridge client

`@opswatch/client` exports `sendOtelBridgePayload` and its `OtelBridgePayload` interface for environments that need a signed normalized bridge request:

```ts
await sendOtelBridgePayload(
  { baseUrl, connectionId, signingSecret },
  { resource: { serviceName: "document-api", deploymentEnvironment: "staging" }, signals: [{ kind: "LOG", name: "document.uploaded" }] }
);
```

This is a TypeScript reference module only; it is not an OTLP SDK or a claim of support for other languages.
