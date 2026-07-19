/**
 * TEST-ONLY Phase 6 Logs/APM fixtures.
 * Not Noble Express live telemetry. Marked for controlled local verification.
 */
export const PHASE6_TEST_ONLY = true as const;

export const phase6HealthyTraffic = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: [
    {
      kind: "SPAN" as const,
      name: "GET /health",
      timestamp: new Date().toISOString(),
      value: 42,
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      attributes: {
        "http.method": "GET",
        "http.route": "/health",
        "http.status_code": 200,
        duration_ms: 42
      }
    }
  ]
};

export const phase6ElevatedLatency = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: Array.from({ length: 8 }, (_, i) => ({
    kind: "SPAN" as const,
    name: "POST /checkout",
    timestamp: new Date().toISOString(),
    value: 800 + i * 50,
    traceId: `cccccccccccccccccccccccccccccccc`.slice(0, 31) + i.toString(16),
    spanId: `ddddddddddddddd${i}`,
    attributes: {
      "http.method": "POST",
      "http.route": "/checkout",
      "http.status_code": 200,
      duration_ms: 800 + i * 50
    }
  }))
};

export const phase6CriticalErrors = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: [
    {
      kind: "SPAN" as const,
      name: "POST /checkout",
      severity: "CRITICAL" as const,
      timestamp: new Date().toISOString(),
      value: 1200,
      traceId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      spanId: "ffffffffffffffff",
      attributes: {
        "http.method": "POST",
        "http.route": "/checkout",
        "http.status_code": 500,
        duration_ms: 1200,
        "exception.type": "CheckoutException",
        "exception.message": "payment failed"
      }
    }
  ]
};

export const phase6RepeatedExceptionLogs = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: Array.from({ length: 4 }, (_, i) => ({
    kind: "LOG" as const,
    name: "exception",
    severity: "CRITICAL" as const,
    timestamp: new Date().toISOString(),
    body: `Unhandled NullPointerException at line ${100 + i}`,
    attributes: { "exception.type": "NullPointerException" }
  }))
};

export const phase6FailingDatabaseSpan = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: [
    {
      kind: "SPAN" as const,
      name: "SELECT orders",
      severity: "HIGH" as const,
      timestamp: new Date().toISOString(),
      value: 300,
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      parentSpanId: "3333333333333333",
      attributes: {
        "db.system": "postgresql",
        "db.operation": "SELECT",
        "span.kind": "CLIENT",
        duration_ms: 300,
        "exception.message": "connection refused"
      }
    }
  ]
};

export const phase6SensitiveRedactionCase = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test",
    attributes: { cookie: "session=should-redact" }
  },
  signals: [
    {
      kind: "LOG" as const,
      name: "auth",
      severity: "HIGH" as const,
      timestamp: new Date().toISOString(),
      body: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret password=super-secret",
      attributes: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
        api_key: "sk_live_should_redact"
      }
    }
  ]
};

export const phase6PartialTrace = {
  resource: {
    serviceName: "phase6-test-checkout",
    deploymentEnvironment: "test"
  },
  signals: [
    {
      kind: "SPAN" as const,
      name: "child",
      timestamp: new Date().toISOString(),
      value: 10,
      traceId: "44444444444444444444444444444444",
      spanId: "5555555555555555",
      parentSpanId: "6666666666666666",
      attributes: { duration_ms: 10 }
    }
  ]
};
