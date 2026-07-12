# Auto-Run Operations (Self-Running OpsWatch)

This guide configures OpsWatch to run continuously and restart automatically.

## What this enables

- API, web, and worker run under PM2 supervision.
- Processes restart automatically on crash.
- State can be saved for auto-restore on machine reboot.

## One-time setup

From repository root:

```powershell
pnpm install
pnpm build:prod
pnpm managed:start
pnpm managed:save
```

Check status:

```powershell
pnpm managed:status
```

## Enable startup on Windows reboot

Run once in elevated PowerShell (Administrator):

```powershell
pnpm exec pm2 startup
```

PM2 prints a command. Run that command exactly once, then save process list:

```powershell
pnpm managed:save
```

## Daily operations

Start all managed services:

```powershell
pnpm managed:start
```

Restart all managed services:

```powershell
pnpm managed:restart
```

Stop all managed services:

```powershell
pnpm managed:stop
```

View logs:

```powershell
pnpm managed:logs
```

## Required environment files

- `apps/api/.env`
- `apps/web/.env.local`
- `apps/worker/.env`

If any required variable is missing, PM2 will restart the failing process repeatedly until fixed.

## Health checks

- API: `http://localhost:4000/api/health`
- Web: `http://localhost:3002`
- Worker: check `pnpm managed:logs` for heartbeat messages
