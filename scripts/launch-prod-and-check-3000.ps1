$ErrorActionPreference = "Stop"

if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "apps\web"
$healthScript = Join-Path $PSScriptRoot "health-check-prod-3000.ps1"
$nextBin = Join-Path $webDir "node_modules\next\dist\bin\next"
$maxAttempts = 8

Write-Output "[1/4] Freeing port 3000"
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Write-Output "Stopping PID $($conn.OwningProcess) on port 3000"
  Stop-Process -Id $conn.OwningProcess -Force
}

Write-Output "[2/4] Building web app (production)"
Push-Location $webDir
try {
  if (Test-Path ".next") {
    Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
  }

  & pnpm build
  if ($LASTEXITCODE -ne 0) {
    throw "Production build failed."
  }

  Write-Output "[3/4] Starting web app on port 3000"
  $proc = Start-Process -FilePath "node.exe" -ArgumentList "`"$nextBin`" start -p 3000" -WorkingDirectory $webDir -PassThru
  Write-Output "WEB_PID=$($proc.Id)"
}
finally {
  Pop-Location
}

Write-Output "[4/4] Running production health check"
$passed = $false
for ($i = 1; $i -le $maxAttempts; $i++) {
  Write-Output "ATTEMPT=$i"
  $output = & powershell -ExecutionPolicy Bypass -File $healthScript
  $output | Write-Output

  $overall = ($output | Where-Object { $_ -like "OVERALL=*" } | Select-Object -Last 1)
  if ($overall -eq "OVERALL=PASS") {
    $passed = $true
    break
  }
}

if (-not $passed) {
  throw "Health check did not reach OVERALL=PASS after $maxAttempts attempts."
}

Write-Output "DONE=PASS"
