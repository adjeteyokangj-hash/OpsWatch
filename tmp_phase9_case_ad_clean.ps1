$ErrorActionPreference = "Stop"

$token = (
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/auth/login" -ContentType "application/json" -Body '{"email":"admin@opswatch.local","password":"ChangeMe123!"}'
).token
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$projects = Invoke-RestMethod -Method Get -Uri "http://localhost:4000/api/projects" -Headers $headers
$services = Invoke-RestMethod -Method Get -Uri "http://localhost:4000/api/services" -Headers $headers
$projectId = $projects[0].id
$serviceId = $services[0].id

Invoke-RestMethod -Method Put -Uri "http://localhost:4000/api/remediation/policy" -Headers $headers -Body (@{ policyType = "GLOBAL"; policyKey = ""; enabled = $true } | ConvertTo-Json -Compress) | Out-Null
Invoke-RestMethod -Method Put -Uri "http://localhost:4000/api/remediation/policy" -Headers $headers -Body (@{ policyType = "PROJECT"; policyKey = $projectId; enabled = $true } | ConvertTo-Json -Compress) | Out-Null
Invoke-RestMethod -Method Put -Uri "http://localhost:4000/api/remediation/policy" -Headers $headers -Body (@{ policyType = "ACTION"; policyKey = "RERUN_SSL_CHECK"; enabled = $true } | ConvertTo-Json -Compress) | Out-Null

$incident = "case-ad-clean-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$body = @{ action = "RERUN_SSL_CHECK"; context = @{ projectId = $projectId; incidentId = $incident; serviceId = $serviceId; extra = @{ severity = "LOW" } } } | ConvertTo-Json -Depth 10 -Compress

try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/$incident/auto-run" -Headers $headers -Body $body | Out-Null
  Write-Output "CASE_A_CLEAN=SUCCESS incident=$incident"
} catch {
  Write-Output ("CASE_A_CLEAN=FAIL status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}

try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/$incident/auto-run" -Headers $headers -Body $body | Out-Null
  Write-Output "CASE_D_CLEAN_SECOND=UNEXPECTED_SUCCESS incident=$incident"
} catch {
  Write-Output ("CASE_D_CLEAN_SECOND=BLOCKED status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}
