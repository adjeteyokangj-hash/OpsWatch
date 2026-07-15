# OpsWatch Architecture

> **Detailed Phase 1 assessment (2026-07-15):** see [`architecture/README.md`](./architecture/README.md).

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

## Target product hierarchy (planned; not yet in schema)

Organisation → Region? → Location/Branch → System → Module → Workflow → Component  
Modes: Centralised | Distributed | Hybrid — see `architecture/08-branch-aware-location-design.md`.
