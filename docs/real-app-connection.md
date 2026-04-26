# Real App Connection Guide

## 1. Start OpsWatch Stack

- API on `http://localhost:4000`
- Web on `http://localhost:3002`
- Worker running continuously

## 2. Connect App via `@opswatch/client`

Use the included demo sender:

```bash
pnpm demo:real-app
```

Environment overrides:

- `OPSWATCH_BASE_URL`
- `OPSWATCH_PROJECT_KEY`
- `OPSWATCH_SIGNING_SECRET`
- `DEMO_APP_NAME`
- `DEMO_APP_VERSION`
- `DEMO_HEARTBEAT_INTERVAL_MS` (default 300000)

## 3. What It Sends

- Heartbeat every 5 minutes by default
- One structured event at startup

## 4. Verify in Dashboard

- Open projects/incidents/alerts pages
- Confirm heartbeat freshness updates
- Confirm event appears in timeline and impacts incident/alert flow

## 5. Verify Monitoring Loop

```bash
pnpm verify:monitoring
```

This validates:

- HTTP check failure creates alert
- Recovery resolves alert
- Heartbeat stale creates alert
- Fresh heartbeat resolves alert
- SSL checks generate alerts/results
