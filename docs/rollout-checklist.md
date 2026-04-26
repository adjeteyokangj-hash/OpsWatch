# MVP Rollout Checklist

OpsWatch reaches MVP when one real production-style app can be monitored end to end: signed ingestion, scheduled checks, alert creation, notification delivery, dashboard visibility, and recovery resolution.

## 1. Repo Health

- [ ] Install dependencies from a clean checkout with `pnpm install`
- [ ] Run `pnpm -r typecheck` successfully
- [ ] Run `pnpm -r test` successfully
- [ ] Replace placeholder lint scripts with real linting or document lint as out of scope
- [ ] Put the project under Git version control before production rollout

## 2. Infrastructure

- [ ] Provision PostgreSQL
- [ ] Set `DATABASE_URL`, `JWT_SECRET`, `OPSWATCH_WEB_URL`, and `OPSWATCH_API_URL`
- [ ] Run Prisma generate, migration, and seed
- [ ] Deploy API
- [ ] Deploy web dashboard
- [ ] Deploy worker as a persistent process
- [ ] Confirm API, web, and worker restart cleanly

## 3. Admin Access

- [ ] Create an organization
- [ ] Create an admin user
- [ ] Verify login from the deployed dashboard
- [ ] Verify protected API routes reject missing or invalid tokens
- [ ] Verify admin-only actions reject non-admin users

## 4. First Monitored App

- [ ] Create the first project in OpsWatch
- [ ] Create at least one critical service
- [ ] Create one HTTP check for the service
- [ ] Generate and store the project API key and signing secret
- [ ] Install or wire `@opswatch/client` in the monitored app
- [ ] Send a heartbeat every 5 minutes
- [ ] Send at least one structured test event
- [ ] Verify heartbeats and events appear in OpsWatch

## 5. Alert Loop

- [ ] Simulate an HTTP check failure
- [ ] Confirm check results are stored
- [ ] Confirm alert severity escalates according to monitoring standards
- [ ] Simulate a missed heartbeat
- [ ] Confirm stale heartbeat alert is created
- [ ] Simulate service recovery
- [ ] Confirm open check alerts resolve

## 6. Notifications

- [ ] Configure one email notification channel or webhook notification channel
- [ ] Trigger a test alert
- [ ] Confirm the notification is delivered
- [ ] Trigger an escalation condition
- [ ] Confirm escalation notification is delivered
- [ ] Confirm notification failures are logged

## 7. Dashboard Demo Path

- [ ] Dashboard shows total, healthy, degraded, and down projects
- [ ] Project detail page shows services, checks, and current health
- [ ] Alerts page supports viewing open alerts
- [ ] Incident page shows timeline and current status
- [ ] Status page shows public-facing project state
- [ ] Empty, loading, and error states are presentable enough for a customer demo

## 8. Security Basics

- [ ] Ingestion requires project key, timestamp, and signature
- [ ] Stale ingestion timestamps are rejected
- [ ] CORS only allows the deployed web origin in production
- [ ] Secrets are not shown in dashboard pages or logs
- [ ] Production env values are not committed

## 9. MVP Acceptance Test

- [ ] A real app sends a heartbeat
- [ ] OpsWatch runs checks against the app
- [ ] A simulated outage creates an alert or incident
- [ ] OpsWatch sends a notification
- [ ] The dashboard shows the problem
- [ ] Recovery resolves the alert
- [ ] The full flow can be demonstrated without manual database edits

## 10. Command Shortcuts

Use these repo scripts to execute the checklist quickly:

- `pnpm --filter @opswatch/web test`
- `pnpm -r lint`
- `pnpm verify:monitoring`
- `pnpm demo:real-app`
- `pnpm notify:webhook-listener`
- `pnpm verify:notifications`
- `pnpm dashboard:smoke`
