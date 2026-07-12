# OpsWatch

OpsWatch is a pnpm monorepo for monitoring, incident insights, and remediation workflows.

## Repository Layout

- `apps/api`: Express + Prisma API
- `apps/web`: Next.js frontend
- `apps/worker`: Background jobs and notifications
- `packages/shared`: Shared types/schemas/constants
- `packages/opswatch-client`: Reusable client package
- `docs`: Architecture, deployment, and runbooks

## Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL (for `apps/api`)

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment templates:

```bash
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env.local
copy apps\worker\.env.example apps\worker\.env
```

3. Generate Prisma client and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

4. Start PostgreSQL locally (default: `localhost:5432`, database `opswatch`).

5. Start all services:

```bash
pnpm dev
```

The dev launcher automatically frees stale processes on ports **4000** and **3000** before starting. If you still see `EADDRINUSE`, run:

```bash
pnpm dev:free-ports
pnpm dev
```

If worker logs show `Can't reach database server at localhost:5432`, PostgreSQL is not running.

To run continuously with automatic restarts (managed mode):

```bash
pnpm build:prod
pnpm managed:start
```

## Common Commands

- `pnpm dev`: Start all apps in parallel
- `pnpm dev:api`: Start API only
- `pnpm dev:web`: Start web only
- `pnpm dev:worker`: Start worker only
- `pnpm lint`: Run lint checks across workspace
- `pnpm typecheck`: Run type checks across workspace
- `pnpm -r --if-present test`: Run package tests where defined

## Documentation

- `docs/architecture.md`
- `docs/auto-run-operations.md`
- `docs/diagnosis-remediation-roadmap.md`
- `docs/deployment-runbook.md`
- `docs/implementation-sprint-checklist.md`
- `docs/monitoring-standards.md`
- `docs/project-onboarding.md`

## Notes

- Keep real secrets out of git.
- Use `.env.example` files as the source of truth for required configuration keys.
