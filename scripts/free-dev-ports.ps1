param(
  [int[]] $Ports = @(4000, 3000)
)

foreach ($port in $Ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "[free-dev-ports] Port $port is free."
    continue
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    Write-Host "[free-dev-ports] Stopping PID $processId on port $port"
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "[free-dev-ports] Done."
