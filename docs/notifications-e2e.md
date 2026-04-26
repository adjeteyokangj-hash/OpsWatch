# Notifications End-to-End Test

## 1. Start Webhook Listener

```bash
pnpm notify:webhook-listener
```

By default it listens on port `4011` and writes to `tmp/notification-events.jsonl`.

## 2. Trigger Notification Flow

In another terminal:

```bash
pnpm verify:notifications
```

This script:

- Creates/uses a webhook notification channel
- Simulates outage with a failing HTTP check
- Triggers alert notification (`triggered`)
- Simulates recovery
- Verifies recovery notification (`resolved`)

## 3. Expected Outcome

- Console prints `NOTIFICATIONS_E2E_OK`
- `tmp/notification-events.jsonl` contains both `triggered` and `resolved` reasons
