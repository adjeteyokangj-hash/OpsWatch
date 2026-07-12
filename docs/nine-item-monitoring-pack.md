# Nine-Item Monitoring Pack

This pack configures the following service health targets:

- App server
- Database
- Admin routes
- Customer quote API
- Shop API
- Payments
- Email service
- CMS
- Storage/uploads

## Run Setup

Set a project slug and health URLs, then run:

```bash
set MONITORING_PROJECT_SLUG=sparkle
set APP_SERVER_HEALTH_URL=https://sparklevaleting.com/health
set DATABASE_HEALTH_URL=https://sparklevaleting.com/health/db
set ADMIN_ROUTES_HEALTH_URL=https://sparklevaleting.com/admin/health
set CUSTOMER_QUOTE_API_HEALTH_URL=https://sparklevaleting.com/api/quotes/health
set SHOP_API_HEALTH_URL=https://sparklevaleting.com/api/shop/health
set PAYMENTS_HEALTH_URL=https://sparklevaleting.com/api/payments/health
set EMAIL_SERVICE_HEALTH_URL=https://sparklevaleting.com/api/email/health
set CMS_HEALTH_URL=https://cms.sparklevaleting.com/health
set STORAGE_UPLOADS_HEALTH_URL=https://sparklevaleting.com/api/uploads/health
pnpm monitoring:setup-9
```

If a URL env var is missing, the script still creates the service/check records but marks checks inactive until a URL is provided.

## Strict Production Workflow

For production use, run validation first (or use the combined strict command):

```bash
pnpm monitoring:validate-9
pnpm monitoring:setup-9
```

Or:

```bash
pnpm monitoring:setup-9:strict
```

Validation rules:

- Fails if any of the 9 required `*_HEALTH_URL` variables is missing
- Fails if any required URL is not `http://` or `https://`
- Warns (without failing) if `MONITORING_PROJECT_SLUG` is missing

## Recommended Thresholds and Severity

Severity for HTTP/KEYWORD/RESPONSE_TIME checks is computed by consecutive failures:

- At configured `failureThreshold`: `MEDIUM`
- At 3+ consecutive failures: `HIGH`
- At 5+ consecutive failures: `CRITICAL`

| Item | Check Types | Interval | Failure Threshold | Recovery Threshold | Recommended Alert Severity Progression |
|---|---|---:|---:|---:|---|
| App server | HTTP + RESPONSE_TIME (1500ms) | 60s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Database | HTTP + KEYWORD(`ok`) | 60s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Admin routes | HTTP | 60s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Customer quote API | HTTP + RESPONSE_TIME (1500ms) | 60s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Shop API | HTTP + RESPONSE_TIME (1500ms) | 60s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Payments | HTTP + RESPONSE_TIME (1200ms) | 60s | 2 | 2 | 2 fails MEDIUM (degraded signal), 3 fails HIGH, 5 fails CRITICAL |
| Email service | HTTP | 120s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| CMS | HTTP | 120s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |
| Storage/uploads | HTTP + KEYWORD(`ok`) | 120s | 3 | 2 | 3 fails HIGH, 5 fails CRITICAL |

## Important Notes

- `Check` execution currently probes `Service.baseUrl`, so each service should point to a health endpoint URL directly.
- Native direct protocol checks (for example SQL-level DB ping or SMTP-level email probe) are not part of this pack. Use dedicated health endpoints from your app/platform.
- You can complement this with event-based signals (`PAYMENT_FAILED`, `EMAIL_FAILED`, `SERVICE_DOWN`, and related types) for richer diagnosis.
