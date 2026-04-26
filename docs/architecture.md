# OpsWatch Architecture

## Components

- web: Next.js admin dashboard
- api: Express + Prisma API
- worker: background monitoring and alert jobs
- shared: shared enums, types, schemas
- opswatch-client: connector SDK for monitored apps

## Data Flow

1. Client apps send signed heartbeat and event payloads.
2. API validates signatures and stores telemetry.
3. Worker executes checks and writes check results.
4. API and worker create alerts/incidents from rules.
5. Dashboard renders project health and active incidents.
