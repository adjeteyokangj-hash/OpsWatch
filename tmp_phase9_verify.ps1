$ErrorActionPreference = "Stop"

$token = (
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/auth/login" -ContentType "application/json" -Body '{"email":"admin@opswatch.local","password":"ChangeMe123!"}'
).token

$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
}

Write-Output "AUTH_OK"

$projects = Invoke-RestMethod -Method Get -Uri "http://localhost:4000/api/projects" -Headers $headers
$services = Invoke-RestMethod -Method Get -Uri "http://localhost:4000/api/services" -Headers $headers
$projectId = $projects[0].id
$serviceId = $services[0].id
Write-Output "CTX_OK project=$projectId service=$serviceId"

$policyPayloads = @(
  @{ policyType = "GLOBAL"; policyKey = ""; enabled = $true },
  @{ policyType = "PROJECT"; policyKey = $projectId; enabled = $true },
  @{ policyType = "ACTION"; policyKey = "RETRY_WEBHOOKS"; enabled = $true },
  @{ policyType = "ACTION"; policyKey = "RERUN_HTTP_CHECK"; enabled = $true }
)

foreach ($payload in $policyPayloads) {
  Invoke-RestMethod -Method Put -Uri "http://localhost:4000/api/remediation/policy" -Headers $headers -Body ($payload | ConvertTo-Json -Compress) | Out-Null
}
Write-Output "POLICY_OK"

# Case A
$bodyA = @{ action = "RETRY_WEBHOOKS"; context = @{ projectId = $projectId; incidentId = "case-a"; extra = @{ severity = "LOW" } } } | ConvertTo-Json -Depth 10 -Compress
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/case-a/auto-run" -Headers $headers -Body $bodyA | Out-Null
  Write-Output "CASE_A=SUCCESS"
} catch {
  Write-Output ("CASE_A=FAIL status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}

# Case B
$bodyB = @{ action = "RESTART_SERVICE"; context = @{ projectId = $projectId; incidentId = "case-b"; serviceId = $serviceId; extra = @{ severity = "LOW" } } } | ConvertTo-Json -Depth 10 -Compress
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/case-b/auto-run" -Headers $headers -Body $bodyB | Out-Null
  Write-Output "CASE_B=UNEXPECTED_SUCCESS"
} catch {
  Write-Output ("CASE_B=BLOCKED status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}

# Seed failures for suppression
$seedJs = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email: "admin@opswatch.local" }, select: { organizationId: true } });
  for (let i = 0; i < 5; i++) {
    await prisma.remediationLog.create({
      data: {
        organizationId: user.organizationId,
        action: "RERUN_HTTP_CHECK",
        status: "FAILED",
        incidentId: "seed-suppression",
        serviceId: process.argv[2],
        contextJson: { seed: true, i },
        executionMode: "MANUAL",
        executedBy: "seed-script",
        resultJson: { reason: "seed-failure" },
        createdAt: new Date(Date.now() - i * 60000)
      }
    });
  }
  console.log("SEED_OK");
  await prisma.$disconnect();
})();
'@
$seedPath = "c:\Users\edwar\OneDrive\My Project\OpsWatch\opswatch\apps\api\tmp-seed-suppression.js"
Set-Content -Path $seedPath -Value $seedJs -Encoding UTF8
Push-Location "c:\Users\edwar\OneDrive\My Project\OpsWatch\opswatch\apps\api"
node $seedPath $serviceId
Pop-Location
Remove-Item $seedPath -Force

# Case C
$bodyC = @{ action = "RERUN_HTTP_CHECK"; context = @{ projectId = $projectId; incidentId = "case-c"; serviceId = $serviceId; extra = @{ severity = "LOW" } } } | ConvertTo-Json -Depth 10 -Compress
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/case-c/auto-run" -Headers $headers -Body $bodyC | Out-Null
  Write-Output "CASE_C=UNEXPECTED_SUCCESS"
} catch {
  Write-Output ("CASE_C=BLOCKED status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}

# Case D
$bodyD = @{ action = "RETRY_WEBHOOKS"; context = @{ projectId = $projectId; incidentId = "case-d"; extra = @{ severity = "LOW" } } } | ConvertTo-Json -Depth 10 -Compress
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/case-d/auto-run" -Headers $headers -Body $bodyD | Out-Null
  Write-Output "CASE_D_FIRST=SUCCESS"
} catch {
  Write-Output ("CASE_D_FIRST=FAIL status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}

try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/remediation/case-d/auto-run" -Headers $headers -Body $bodyD | Out-Null
  Write-Output "CASE_D_SECOND=UNEXPECTED_SUCCESS"
} catch {
  Write-Output ("CASE_D_SECOND=BLOCKED status=" + [int]$_.Exception.Response.StatusCode + " body=" + $_.ErrorDetails.Message)
}
