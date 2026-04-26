param([int]$Port = 3000, [int]$TimeoutSeconds = 240, [switch]$CleanCache, [switch]$StopWhenDone)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$webDir = Join-Path $repoRoot "apps/web"
$logDir = Join-Path $repoRoot "tmp"
$stdoutLogPath = Join-Path $logDir "web-dev-runtime.stdout.log"
$stderrLogPath = Join-Path $logDir "web-dev-runtime.stderr.log"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Step {
  param([string]$Message)
  Write-Output ("[frontend-verify] " + $Message)
}

function Stop-StaleNextDev {
  $targets = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match "next" -and $_.CommandLine -match "dev" }

  foreach ($proc in $targets) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-Step ("Stopped stale next dev process PID=" + $proc.ProcessId)
    } catch {
      Write-Step ("Could not stop PID=" + $proc.ProcessId)
    }
  }
}

function Wait-UrlReady {
  param(
    [string]$Url,
    [int]$Seconds,
    [int[]]$AllowedStatusCodes
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
      if ($AllowedStatusCodes -contains [int]$response.StatusCode) {
        return $true
      }
    } catch {
      $status = $null
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode
      }
      if ($null -ne $status -and $AllowedStatusCodes -contains $status) {
        return $true
      }
    }
    Start-Sleep -Milliseconds 1200
  }

  return $false
}

Write-Step "Stopping stale Next dev processes"
Stop-StaleNextDev

if ($CleanCache) {
  $nextDir = Join-Path $webDir ".next"
  if (Test-Path $nextDir) {
    Write-Step "Removing apps/web/.next"
    Remove-Item -Path $nextDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Step "Starting web dev server"
$command = "Set-Location '$webDir'; node node_modules/next/dist/bin/next dev -p $Port"
$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-Command", $command -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -PassThru

try {
  $loginReady = Wait-UrlReady -Url ("http://localhost:{0}/login" -f $Port) -Seconds $TimeoutSeconds -AllowedStatusCodes @(200)
  if (-not $loginReady) {
    throw "Login page was not ready before timeout"
  }

  $insightsReady = Wait-UrlReady -Url ("http://localhost:{0}/insights" -f $Port) -Seconds 60 -AllowedStatusCodes @(200, 302, 307)
  if (-not $insightsReady) {
    throw "Insights route was not reachable before timeout"
  }

  Write-Step "PASS: frontend runtime verified (/login and /insights reachable)"
  Write-Step ("Dev server PID=" + $process.Id + ", logs=" + $stdoutLogPath + " | " + $stderrLogPath)
}
finally {
  if ($StopWhenDone) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      Write-Step "Stopped dev server started by verifier"
    } catch {
      Write-Step "Dev server process had already exited"
    }
  }
}
