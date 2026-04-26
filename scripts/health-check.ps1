$ErrorActionPreference = "Stop"

if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$baseApi = "http://localhost:4000"
$baseWeb = "http://localhost:3002"

$allPass = $true

function Get-StatusCode {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [hashtable]$Headers
  )

  $args = @("-s", "--connect-timeout", "5", "--max-time", "20", "-o", "NUL", "-w", "%{http_code}")
  if ($Headers) {
    foreach ($key in $Headers.Keys) {
      $args += "-H"
      $args += "${key}: $($Headers[$key])"
    }
  }
  $args += $Url
  $code = & curl.exe @args
  return "$code".Trim()
}

function Write-CheckResult {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Code,
    [switch]$AllowRedirect
  )

  $isNumeric = $Code -match "^\d{3}$"
  $is2xx = $isNumeric -and [int]$Code -ge 200 -and [int]$Code -lt 300
  $is3xx = $isNumeric -and [int]$Code -ge 300 -and [int]$Code -lt 400
  $isPass = $is2xx -or ($AllowRedirect -and $is3xx)

  if (-not $isPass) {
    $script:allPass = $false
  }

  $result = if ($isPass) { "PASS" } else { "FAIL" }
  Write-Output "$Name=$Code $result"
}

Write-Output "=== Public checks ==="
$apiHealth = Get-StatusCode -Url "$baseApi/api/health"
$webRoot = Get-StatusCode -Url "$baseWeb/"
$webLogin = Get-StatusCode -Url "$baseWeb/login"
$webDashboard = Get-StatusCode -Url "$baseWeb/dashboard"

Write-CheckResult -Name "API_HEALTH" -Code $apiHealth
Write-CheckResult -Name "WEB_ROOT" -Code $webRoot -AllowRedirect
Write-CheckResult -Name "WEB_LOGIN" -Code $webLogin -AllowRedirect
Write-CheckResult -Name "WEB_DASHBOARD" -Code $webDashboard -AllowRedirect

Write-Output "`n=== Auth login ==="
$loginBody = '{"email":"admin@opswatch.local","password":"ChangeMe123!"}'
$login = Invoke-RestMethod -Method Post -Uri "$baseApi/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.token

if (-not $token) {
  throw "Login failed: no token returned."
}

$authHeaders = @{ Authorization = "Bearer $token" }

Write-Output "LOGIN=200 PASS"

Write-Output "`n=== Authenticated API checks ==="
$projects = Get-StatusCode -Url "$baseApi/api/projects" -Headers $authHeaders
$alerts = Get-StatusCode -Url "$baseApi/api/alerts" -Headers $authHeaders
$incidents = Get-StatusCode -Url "$baseApi/api/incidents" -Headers $authHeaders
$status = Get-StatusCode -Url "$baseApi/api/status/public" -Headers $authHeaders
$accuracy = Get-StatusCode -Url "$baseApi/api/remediation/accuracy/metrics" -Headers $authHeaders
$autoRunPolicy = Get-StatusCode -Url "$baseApi/api/remediation/policy" -Headers $authHeaders

Write-CheckResult -Name "PROJECTS" -Code $projects
Write-CheckResult -Name "ALERTS" -Code $alerts
Write-CheckResult -Name "INCIDENTS" -Code $incidents
Write-CheckResult -Name "STATUS" -Code $status
Write-CheckResult -Name "ACCURACY" -Code $accuracy
Write-CheckResult -Name "AUTO_RUN_POLICY" -Code $autoRunPolicy

$overall = if ($allPass) { "PASS" } else { "FAIL" }
Write-Output "`nOVERALL=$overall"
Write-Output "=== Done ==="
