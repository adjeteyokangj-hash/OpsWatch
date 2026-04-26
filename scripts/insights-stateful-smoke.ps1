param(
  [string]$ApiBase = "http://localhost:4000/api",
  [string]$Email = "admin@opswatch.local",
  [string]$Password = "ChangeMe123!"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiDir = Join-Path $repoRoot "apps/api"

function Write-Step {
  param([string]$Message)
  Write-Output ("[insights-smoke] " + $Message)
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    [object]$Body = $null
  )

  $uri = "$ApiBase$Path"
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 12 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers -ContentType "application/json" -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers
}

function Reset-RecommendationFixture {
  param([string]$RecommendationId)

  $resetScript = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const recommendationId = process.argv[2];

(async () => {
  if (!recommendationId) {
    throw new Error("recommendationId is required");
  }

  await prisma.insightRecommendation.updateMany({
    where: { id: recommendationId },
    data: {
      status: "OPEN",
      appliedAt: null,
      dismissedAt: null,
    },
  });

  await prisma.insightActionRun.deleteMany({
    where: { insightRecommendationId: recommendationId },
  });

  console.log("FIXTURE_RESET_OK " + recommendationId);
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error("FIXTURE_RESET_FAILED", error);
  await prisma.$disconnect();
  process.exit(1);
});
'@

  $tmpPath = Join-Path $apiDir "tmp-insights-fixture-reset.js"
  Set-Content -Path $tmpPath -Value $resetScript -Encoding UTF8
  Push-Location $apiDir
  try {
    node $tmpPath $RecommendationId | Out-Null
  }
  finally {
    Pop-Location
    Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue
  }
}

Write-Step "Logging in"
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" -ContentType "application/json" -Body (@{ email = $Email; password = $Password } | ConvertTo-Json -Compress)
if (-not $login.token) {
  throw "Authentication failed: no token returned"
}

$headers = @{ Authorization = "Bearer $($login.token)" }

Write-Step "Loading projects and insight state"
$insights = Invoke-Api -Method Get -Path "/insights/product" -Headers $headers
if (-not $insights.projects -or $insights.projects.Count -eq 0) {
  throw "No projects available for insight smoke"
}

$project = $insights.projects | Sort-Object -Property coverageScore | Select-Object -First 1
$openRecommendations = @($project.recommendations | Where-Object { $_.status -eq "OPEN" })

if ($openRecommendations.Count -eq 0) {
  Write-Step "No OPEN recommendations in product view; reopening latest APPLIED recommendation"
  $applied = Invoke-Api -Method Get -Path ("/insights/recommendations?projectId={0}&status=APPLIED" -f $project.id) -Headers $headers
  $fallback = @($applied.recommendations | Select-Object -First 1)
  if ($fallback.Count -eq 0) {
    throw "No OPEN or APPLIED recommendations available for smoke"
  }
  Reset-RecommendationFixture -RecommendationId $fallback[0].id
  $recommendationsResponse = Invoke-Api -Method Get -Path ("/insights/recommendations?projectId={0}&status=OPEN" -f $project.id) -Headers $headers
  $openRecommendations = @($recommendationsResponse.recommendations)
}

$applyCandidate = $openRecommendations | Where-Object {
  $_.type -in @("COVERAGE_TARGET", "MONITORING_PROFILE", "SYNTHETIC_JOURNEY")
} | Select-Object -First 1

if (-not $applyCandidate) {
  throw "Could not locate an apply-capable OPEN recommendation"
}

Write-Step ("Selected recommendation {0} ({1}/{2})" -f $applyCandidate.id, $applyCandidate.type, $applyCandidate.targetKey)

Write-Step "Applying recommendation"
$applyResult = Invoke-Api -Method Post -Path ("/insights/recommendations/{0}/apply" -f $applyCandidate.id) -Headers $headers -Body @{
  projectId = $project.id
  approve = $true
}

if (-not @("APPLIED", "TRACKED") -contains $applyResult.status) {
  throw ("Unexpected apply status: " + $applyResult.status)
}
Write-Step ("Apply status=" + $applyResult.status)

if ($applyResult.status -eq "APPLIED") {
  $appliedState = Invoke-Api -Method Get -Path ("/insights/recommendations?projectId={0}&status=APPLIED" -f $project.id) -Headers $headers
  if (-not (@($appliedState.recommendations).id -contains $applyCandidate.id)) {
    throw "Applied recommendation was not found in APPLIED state"
  }
}
if ($applyResult.status -eq "TRACKED") {
  $trackedRuns = Invoke-Api -Method Get -Path ("/insights/action-runs?projectId={0}" -f $project.id) -Headers $headers
  $hasTrackedRun = @($trackedRuns.actionRuns | Where-Object {
      $_.insightRecommendationId -eq $applyCandidate.id -and $_.status -in @("TRACKED", "COMPLETED")
    }).Count -gt 0
  if (-not $hasTrackedRun) {
    throw "Tracked apply did not produce a tracked/completed action run"
  }
}
Write-Step "Apply verification passed"

Write-Step "Resetting fixture for dismiss path"
Reset-RecommendationFixture -RecommendationId $applyCandidate.id

Write-Step "Dismissing recommendation"
$dismissResult = Invoke-Api -Method Post -Path ("/insights/recommendations/{0}/dismiss" -f $applyCandidate.id) -Headers $headers -Body @{
  projectId = $project.id
  reason = "stateful smoke test"
}
if ($dismissResult.status -ne "DISMISSED") {
  throw ("Unexpected dismiss status: " + $dismissResult.status)
}

$dismissedState = Invoke-Api -Method Get -Path ("/insights/recommendations?projectId={0}&status=DISMISSED" -f $project.id) -Headers $headers
if (-not (@($dismissedState.recommendations).id -contains $applyCandidate.id)) {
  throw "Dismissed recommendation was not found in DISMISSED state"
}

$actionRuns = Invoke-Api -Method Get -Path ("/insights/action-runs?projectId={0}" -f $project.id) -Headers $headers
$hasDismissRun = @($actionRuns.actionRuns | Where-Object { $_.insightRecommendationId -eq $applyCandidate.id -and $_.status -eq "DISMISSED" }).Count -gt 0
if (-not $hasDismissRun) {
  throw "Dismissed recommendation did not produce an action run"
}

Write-Step "Resetting fixture for repeatability"
Reset-RecommendationFixture -RecommendationId $applyCandidate.id

Write-Step "PASS: state-aware insights smoke completed successfully"
