# Monitoring Standards

## Baseline Checks

- HTTP uptime checks for all critical services
- Heartbeat every 5 minutes for all integrated apps
- SSL expiry checks on all production domains

## Alerting Rules (MVP)

- HTTP: 1 fail warn, 3 fail high, 5 fail critical
- Heartbeat: 10 min medium, 20 min high
- SSL: <30 days medium, <14 high, <7 critical
