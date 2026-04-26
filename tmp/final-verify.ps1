$ErrorActionPreference = "Stop"
$OW = "http://localhost:4101/api"
$TN = "http://localhost:4100/api"
$orgId = "7e9c1f02-e15a-48e4-a70e-1348427285db"

function JsonReq([string]$Method, [string]$Url, $Body = $null, $Headers = @{}) {
    $params = @{
        Method          = $Method
        Uri             = $Url
        UseBasicParsing = $true
        ContentType     = "application/json"
        ErrorAction     = "Stop"
    }
    if ($Body -ne $null) { $params.Body = ($Body | ConvertTo-Json -Depth 20) }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }
    $resp = Invoke-WebRequest @params
    if ([string]::IsNullOrWhiteSpace($resp.Content)) { return $null }
    return ($resp.Content | ConvertFrom-Json)
}

$owEmail = "smoke.opswatch.final.$(Get-Random -Max 999999)@example.com"
$owPass = "SmokeTest1234!"
try {
    $null = JsonReq "POST" "$OW/auth/register" @{ email = $owEmail; password = $owPass; organizationId = $orgId; name = "OpsWatch Smoke Final" }
} catch {}
$owLogin = JsonReq "POST" "$OW/auth/login" @{ email = $owEmail; password = $owPass }
$owJwt = $owLogin.token
$keyResp = JsonReq "POST" "$OW/org/api-keys" @{
    name = "TN Final Verify $(Get-Date -Format 'yyyyMMddHHmmss')"
    scopes = @("events:write", "heartbeats:write", "alerts:read", "incidents:read")
    environment = "live"
} @{ Authorization = "Bearer $owJwt" }
$owApiKey = $keyResp.key

$tnSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$null = Invoke-WebRequest -Method Post -Uri "http://localhost:4100/api/auth/login" -ContentType "application/json" -Body (@{ email = "owner@smoke.co"; password = "passw0rd!"; companyId = "cmltoy5hj0000as7c081qlh8s" } | ConvertTo-Json) -WebSession $tnSession -UseBasicParsing

$saveBody = @{ apiKey = $owApiKey; baseUrl = "http://localhost:4101"; projectName = "TrueNumeris-Smoke"; environment = "production"; enabled = $true; adminPortalUrl = "http://localhost:4100/admin"; customerPortalUrl = "http://localhost:4100"; backendHealthUrl = "http://localhost:4100/api/healthz" }
$tnSaveRaw = Invoke-WebRequest -Method Put -Uri "$TN/v1/opswatch/connection" -ContentType "application/json" -Body ($saveBody | ConvertTo-Json -Depth 20) -WebSession $tnSession -UseBasicParsing
$tnSave = $tnSaveRaw.Content | ConvertFrom-Json

$tnStatusRaw = Invoke-WebRequest -Method Get -Uri "$TN/v1/opswatch/status" -WebSession $tnSession -UseBasicParsing
$tnStatus = $tnStatusRaw.Content | ConvertFrom-Json
$regBody = @{ projectName = $tnStatus.data.projectName; environment = $tnStatus.data.environment; adminPortalUrl = $tnStatus.data.adminPortalUrl; customerPortalUrl = $tnStatus.data.customerPortalUrl; backendHealthUrl = $tnStatus.data.backendHealthUrl }
$regResp = JsonReq "POST" "$OW/truenumeris/register" $regBody @{ "x-api-key" = $owApiKey }
$projectId = $regResp.data.project.id

$svcResp = JsonReq "GET" "$OW/projects/$projectId/services" $null @{ Authorization = "Bearer $owJwt" }
$services = @()
if ($svcResp -is [array]) {
    $services = $svcResp
} elseif ($svcResp.data -is [array]) {
    $services = $svcResp.data
} elseif ($svcResp.items -is [array]) {
    $services = $svcResp.items
}

$allChecksResp = JsonReq "GET" "$OW/checks" $null @{ Authorization = "Bearer $owJwt" }
$allChecks = @()
if ($allChecksResp -is [array]) {
    $allChecks = $allChecksResp
} elseif ($allChecksResp.data -is [array]) {
    $allChecks = $allChecksResp.data
} elseif ($allChecksResp.items -is [array]) {
    $allChecks = $allChecksResp.items
}

$serviceViews = @()
foreach ($s in $services) {
    $sid = if ($s.id) { [string]$s.id } else { "" }
    $checks = @()
    if ($sid) {
        $checks = @($allChecks | Where-Object { [string]$_.serviceId -eq $sid })
    }
    $serviceViews += [pscustomobject]@{
        id = $s.id
        name = $s.name
        type = $s.type
        baseUrl = $s.baseUrl
        checks = $checks
    }
}

[pscustomobject]@{
    registrationResponse = $regResp
    projectName = $regResp.data.project.name
    servicesWithChecks = $serviceViews
    rawServicesResponse = $svcResp
    tnSaveConnectionResponse = $tnSave
} | ConvertTo-Json -Depth 50
