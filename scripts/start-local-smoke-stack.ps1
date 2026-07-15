param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[smoke-stack] Freeing ports 3000 and 4000..."
& powershell -ExecutionPolicy Bypass -File "$Root\scripts\free-dev-ports.ps1"
Start-Sleep -Seconds 1

$apiEnv = Join-Path $Root "apps\api\.env"
if (-not (Test-Path $apiEnv)) { throw "Missing apps/api/.env" }

if ((Select-String -Path $apiEnv -Pattern "OPSWATCH_PREDICTIONS_ENABLED" -Quiet) -eq $false) {
  Add-Content -Path $apiEnv -Value "`nOPSWATCH_PREDICTIONS_ENABLED=false"
} else {
  (Get-Content $apiEnv) |
    ForEach-Object {
      if ($_ -match "^\s*OPSWATCH_PREDICTIONS_ENABLED\s*=") {
        "OPSWATCH_PREDICTIONS_ENABLED=false"
      } else {
        $_
      }
    } | Set-Content $apiEnv
}

if (-not $SkipBuild) {
  Write-Host "[smoke-stack] Building API..."
  pnpm --filter @opswatch/api build
  if ($LASTEXITCODE -ne 0) { throw "API build failed" }
  Write-Host "[smoke-stack] Building web..."
  pnpm --filter @opswatch/web build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed" }
}

$logs = Join-Path $Root "test-artifacts\stack-logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# NODE_ENV=development so session cookies are not Secure (Playwright request + http local).
# OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT bypasses the global IP rate limiter for auth-heavy
# Playwright smokes. The API refuses this flag when NODE_ENV/VERCEL_ENV is production.
# Optional header bypass also requires OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS=true (non-prod only).
Write-Host "[smoke-stack] Starting API..."
$apiCmd = @"
`$env:NODE_ENV='development'
`$env:OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT='true'
`$env:OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS='true'
Set-Location '$Root\apps\api'
pnpm exec node dist/index.js *> '$logs\api.log'
"@
$apiProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-Command", $apiCmd) -PassThru -WindowStyle Hidden

Write-Host "[smoke-stack] Starting web..."
# Force proxy-to-:4000 — embedded Next API + separate API doubles Prisma pools and flakes smoke.
$webCmd = @"
`$env:OPSWATCH_EMBEDDED_API='false'
`$env:OPSWATCH_API_ORIGIN='http://127.0.0.1:4000'
Set-Location '$Root'
pnpm --filter @opswatch/web start *> '$logs\web.log'
"@
$webProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-Command", $webCmd) -PassThru -WindowStyle Hidden

Set-Content -Path (Join-Path $logs "pids.txt") -Value "apiShell=$($apiProc.Id)`nwebShell=$($webProc.Id)"

Write-Host "[smoke-stack] Waiting for health..."
$env:STACK_WAIT_MS = "240000"
pnpm exec tsx scripts/wait-local-stack.ts
if ($LASTEXITCODE -ne 0) {
  Get-Content "$logs\api.log" -ErrorAction SilentlyContinue | Select-Object -Last 40
  Get-Content "$logs\web.log" -ErrorAction SilentlyContinue | Select-Object -Last 40
  throw "Stack not ready"
}

Write-Host "[smoke-stack] Fixtures..."
pnpm exec tsx scripts/ensure-smoke-fixtures.ts
if ($LASTEXITCODE -ne 0) { throw "Fixtures failed" }

Write-Host "[smoke-stack] READY"
