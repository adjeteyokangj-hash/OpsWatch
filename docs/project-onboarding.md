# Project Onboarding

## Steps

1. Create Project in OpsWatch.
2. Generate and store API key and signing secret securely.
3. Install @opswatch/client in target app.
4. Expose /api/health and /api/opswatch/status endpoints.
5. Schedule heartbeat every 5 minutes.
6. Send structured events for payment, booking, email, webhook, and cron failures.
7. Verify data arrives in OpsWatch dashboard.
