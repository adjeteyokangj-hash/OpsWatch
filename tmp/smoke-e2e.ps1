$ErrorActionPreference = "Stop"
$OW  = "http://localhost:4101/api"
$TN  = "http://localhost:4100/api"

function Req($method, $url, $body = $null, $headers = @{}) {
    $params = @{
        Method  = $method
        Uri     = $url
        UseBasicParsing = $true
        ContentType = "application/json"
        ErrorAction = "Stop"
    }
    if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
    if ($headers.Count) { $params.Headers = $headers }
    try {
        $r = Invoke-WebRequest @params
        return $r.Content | ConvertFrom-Json
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        $msg  = $_.Exception.Message
        Write-Host "  ERROR $code : $msg"
        try {
            $errBody = $_.Exception.Response.GetResponseStream()
            $reader  = [System.IO.StreamReader]::new($errBody)
            $errText = $reader.ReadToEnd()
            Write-Host "  BODY: $errText"
        } catch {}
        throw
    }
}

Write-Host ""
Write-Host "=== STEP 1: OpsWatch health check ==="
$h = Req GET "$OW/health"
Write-Host "  $($h | ConvertTo-Json -Compress)"

Write-Host ""
Write-Host "=== STEP 2: Register OpsWatch smoke user ==="
$ORG_ID = "7e9c1f02-e15a-48e4-a70e-1348427285db"
$OW_EMAIL = "smoke.opswatch.$(Get-Random -Max 9999)@example.com"
$OW_PASS  = "SmokeTest1234!"
try {
    $reg = Req POST "$OW/auth/register" @{ email=$OW_EMAIL; password=$OW_PASS; organizationId=$ORG_ID; name="OpsWatch Smoke" }
    Write-Host "  Registered: $($reg | ConvertTo-Json -Compress)"
} catch {
    Write-Host "  Register failed (may already exist) – continuing"
}

Write-Host ""
Write-Host "=== STEP 3: Login to OpsWatch ==="
$login = Req POST "$OW/auth/login" @{ email=$OW_EMAIL; password=$OW_PASS }
$OW_JWT = $login.token
Write-Host "  Token (prefix): $($OW_JWT.Substring(0, [Math]::Min(40,$OW_JWT.Length)))..."

Write-Host ""
Write-Host "=== STEP 4: Create OpsWatch API key ==="
$keyResp = Req POST "$OW/org/api-keys" @{
    name        = "TrueNumeris Smoke Key $(Get-Date -Format 'yyyyMMddHHmm')"
    scopes      = @("events:write","heartbeats:write","alerts:read","incidents:read")
    environment = "live"
} -headers @{ Authorization = "Bearer $OW_JWT" }
$OW_API_KEY = $keyResp.key
Write-Host "  Key ID   : $($keyResp.keyId)"
Write-Host "  Key      : $OW_API_KEY"
Write-Host "  Scopes   : $($keyResp.scopes -join ', ')"

Write-Host ""
Write-Host "=== STEP 5: TrueNumeris health check ==="
$tnh = Req GET "$TN/healthz"
Write-Host "  $($tnh | ConvertTo-Json -Compress)"

Write-Host ""
Write-Host "=== STEP 6: Use existing active TrueNumeris company ==="
# Use a pre-seeded active account to avoid COMPANY_ACTIVATION_REQUIRED
$TN_EMAIL      = "owner@smoke.co"
$TN_PASS       = "passw0rd!"
$TN_COMPANY_ID = "cmltoy5hj0000as7c081qlh8s"
Write-Host "  Company  : $TN_COMPANY_ID"
Write-Host "  Email    : $TN_EMAIL"

Write-Host ""
Write-Host "=== STEP 7: Login to TrueNumeris ==="
# TrueNumeris sets the auth token as a cookie, use WebSession to capture it
$tnSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$tnLoginRaw = Invoke-WebRequest -Method POST -Uri "http://localhost:4100/api/auth/login" `
    -ContentType "application/json" `
    -Body (@{ email=$TN_EMAIL; password=$TN_PASS; companyId=$TN_COMPANY_ID } | ConvertTo-Json) `
    -WebSession $tnSession -UseBasicParsing
$tnLoginData = $tnLoginRaw.Content | ConvertFrom-Json
# Extract tn_auth cookie value as Bearer token
$TN_AUTH_COOKIE = ($tnSession.Cookies.GetCookies("http://localhost:4100") | Where-Object { $_.Name -match "tn_auth|auth_token|token" } | Select-Object -First 1)
$TN_JWT = if ($TN_AUTH_COOKIE) { $TN_AUTH_COOKIE.Value } else { "" }
$setCookieHeader = $tnLoginRaw.Headers["Set-Cookie"]
Write-Host "  Login status  : $($tnLoginRaw.StatusCode)"
Write-Host "  Set-Cookie    : $($setCookieHeader | Select-Object -First 1)"
Write-Host "  Cookie count  : $($tnSession.Cookies.Count)"

# Build cookie header string for subsequent requests
$tnCookieHeader = ($tnSession.Cookies.GetCookies("http://localhost:4100") | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "; "
Write-Host "  Cookie header : $(if ($tnCookieHeader.Length -gt 80) { $tnCookieHeader.Substring(0,80) + '...' } else { $tnCookieHeader })"

function ReqTN($method, $url, $body = $null) {
    $params = @{
        Method          = $method
        Uri             = $url
        UseBasicParsing = $true
        ContentType     = "application/json"
        WebSession      = $tnSession
        ErrorAction     = "Stop"
    }
    if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
    $r = Invoke-WebRequest @params
    return $r.Content | ConvertFrom-Json
}

Write-Host ""
Write-Host "=== STEP 8: Save OpsWatch connection in TrueNumeris ==="
$tnSave = ReqTN PUT "$TN/v1/opswatch/connection" @{
    apiKey            = $OW_API_KEY
    baseUrl           = "http://localhost:4101"
    projectName       = "TrueNumeris-Smoke"
    environment       = "production"
    enabled           = $true
    adminPortalUrl    = "http://localhost:4100/admin"
    customerPortalUrl = "http://localhost:4100"
    backendHealthUrl  = "http://localhost:4100/api/healthz"
}
Write-Host "  Response: $($tnSave | ConvertTo-Json -Compress)"

Write-Host ""
Write-Host "=== STEP 9: Verify OpsWatch connection status in TrueNumeris ==="
$tnStatus = ReqTN GET "$TN/v1/opswatch/status"
Write-Host "  connectionStatus : $($tnStatus.data.connectionStatus)"
Write-Host "  hasApiKey        : $($tnStatus.data.hasApiKey)"
Write-Host "  apiKeyMasked     : $($tnStatus.data.apiKeyMasked)"
Write-Host "  adminPortalUrl   : $($tnStatus.data.adminPortalUrl)"
Write-Host "  customerPortalUrl: $($tnStatus.data.customerPortalUrl)"
Write-Host "  backendHealthUrl : $($tnStatus.data.backendHealthUrl)"

Write-Host ""
Write-Host "=== STEP 10: Register TrueNumeris targets in OpsWatch ==="
$reg = Req POST "$OW/truenumeris/register" @{
    projectName       = "TrueNumeris-Smoke"
    environment       = "production"
    adminPortalUrl    = "http://localhost:4100/admin"
    customerPortalUrl = "http://localhost:4100"
    backendHealthUrl  = "http://localhost:4100/api/healthz"
} -headers @{ "x-api-key" = $OW_API_KEY }
Write-Host "  Project  : $($reg.data.project.id) / $($reg.data.project.name)"
Write-Host "  Services :"
$reg.data.monitoredTargets | ForEach-Object {
    Write-Host "    - $($_.name) ($($_.url)) [id=$($_.id)]"
}

Write-Host ""
Write-Host "=== STEP 11: Verify services in OpsWatch DB via API ==="
$svcs = Req GET "$OW/projects/$($reg.data.project.id)/services" -headers @{ Authorization = "Bearer $OW_JWT" }
Write-Host "  Total services: $(if ($svcs.data) { $svcs.data.Count } elseif ($svcs.Count) { $svcs.Count } else { ($svcs | ConvertTo-Json -Depth 3) })"
$svcList = if ($svcs.data) { $svcs.data } else { $svcs }
$svcList | ForEach-Object {
    Write-Host "    Service: $($_.name) | type=$($_.type) | status=$($_.status) | url=$($_.baseUrl)"
}

Write-Host ""
Write-Host "=== SMOKE TEST COMPLETE ==="
