# OpsWatch PostgreSQL backup and rollback drill
# Creates a backup, restores into an isolated recovery database, and validates representative records.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiEnvPath = Join-Path $root "apps/api/.env"
if (-not (Test-Path $apiEnvPath)) { throw "Missing apps/api/.env" }

$envContent = Get-Content $apiEnvPath -Raw
if ($envContent -match 'DATABASE_URL="([^"]+)"') {
  $databaseUrl = $Matches[1]
} elseif ($envContent -match "DATABASE_URL=([^\r\n]+)") {
  $databaseUrl = $Matches[1].Trim('"')
} else {
  throw "DATABASE_URL not found in apps/api/.env"
}

$uri = [Uri]$databaseUrl
$dbName = $uri.AbsolutePath.TrimStart("/").Split("?")[0]
$pgUrl = $databaseUrl -replace "\?.*$", ""
$recoveryDb = "${dbName}_recovery_gate"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root "tmp/db-backups"
$backupFile = Join-Path $backupDir "opswatch-$timestamp.sql"
$migrationStateFile = Join-Path $backupDir "migration-state-$timestamp.txt"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Output "=== OpsWatch backup drill ($timestamp) ==="
Write-Output "source_database=$dbName"
Write-Output "recovery_database=$recoveryDb"

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  $candidatePaths = @(
    "$env:ProgramFiles\PostgreSQL\18\bin\pg_dump.exe",
    "$env:ProgramFiles\PostgreSQL\17\bin\pg_dump.exe",
    "$env:ProgramFiles\PostgreSQL\16\bin\pg_dump.exe"
  )
  foreach ($candidate in $candidatePaths) {
    if (Test-Path $candidate) {
      $binDir = Split-Path $candidate -Parent
      $env:PATH = "$binDir;$env:PATH"
      break
    }
  }
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump not found. Install PostgreSQL client tools and ensure pg_dump is on PATH."
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw "psql not found. Install PostgreSQL client tools and ensure psql is on PATH."
}

Write-Output "Creating backup..."
& pg_dump --dbname=$pgUrl --format=plain --file=$backupFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

$backupSize = (Get-Item $backupFile).Length
Write-Output "backup_file=$backupFile"
Write-Output "backup_size_bytes=$backupSize"

Push-Location (Join-Path $root "apps/api")
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$migrateStatus = (& npx prisma migrate status 2>&1 | Out-String)
$ErrorActionPreference = $previousErrorAction
Pop-Location
Set-Content -Path $migrationStateFile -Value $migrateStatus
Write-Output "migration_state_file=$migrationStateFile"

$adminUrl = $pgUrl -replace "/$dbName", "/postgres"
Write-Output "Preparing isolated recovery database..."
& psql $adminUrl -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$recoveryDb';" | Out-Null
& psql $adminUrl -c "DROP DATABASE IF EXISTS $recoveryDb;" | Out-Null
& psql $adminUrl -c "CREATE DATABASE $recoveryDb;" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to create recovery database" }

$recoveryUrl = $pgUrl -replace "/$dbName", "/$recoveryDb"
Write-Output "Restoring backup into recovery database..."
& psql $recoveryUrl -v ON_ERROR_STOP=1 -f $backupFile
if ($LASTEXITCODE -ne 0) { throw "Restore failed with exit code $LASTEXITCODE" }

$validationSql = Join-Path $backupDir "recovery-validation-$timestamp.sql"
@'
SELECT 'projects' AS entity, COUNT(*)::text AS count FROM "Project";
SELECT 'services' AS entity, COUNT(*)::text AS count FROM "Service";
SELECT 'alerts' AS entity, COUNT(*)::text AS count FROM "Alert";
SELECT 'incidents' AS entity, COUNT(*)::text AS count FROM "Incident";
SELECT 'automation_runs' AS entity, COUNT(*)::text AS count FROM "AutomationRun";
SELECT 'maintenance_windows' AS entity, COUNT(*)::text AS count FROM "MaintenanceWindow";
SELECT 'billing_rows' AS entity, COUNT(*)::text AS count FROM "ProjectBilling";
'@ | Set-Content -Path $validationSql -Encoding UTF8

Write-Output "=== Recovery validation ==="
& psql $recoveryUrl -v ON_ERROR_STOP=1 -f $validationSql
if ($LASTEXITCODE -ne 0) { throw "Recovery validation failed with exit code $LASTEXITCODE" }

Write-Output "=== Drill result ==="
Write-Output "BACKUP_DRILL_PASS"
Write-Output "estimated_recovery_time_minutes=15-30 depending on database size and operator availability"
Write-Output "responsible_operator=Platform/on-call administrator"
Write-Output "rollback_preference=application rollback first; database restore only when integrity requires it"
