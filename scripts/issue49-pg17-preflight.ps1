# Issue #49 - preflight local, no mutations, no secret output.
# Usage: powershell -NoProfile -File scripts/issue49-pg17-preflight.ps1
# Requires execution from a local checkout containing the candidate migration.
$ErrorActionPreference = 'Stop'
$repo = (git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repo)) { throw 'Debe ejecutarse dentro de un repositorio Git de Raxi HQ.' }
Write-Host '=== GIT: evidencia del checkout ==='
git rev-parse HEAD
git status --short
Write-Host '=== Candidato SQL (sin ejecutar) ==='
$files = @(
  'supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql',
  'supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql',
  'supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql',
  'supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql',
  'supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql'
)
foreach ($relative in $files) {
  $full = Join-Path $repo $relative
  if (-not (Test-Path -LiteralPath $full)) {
    Write-Host "FALTA: $relative" -ForegroundColor Yellow
  } else {
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    Write-Host "$relative | SHA256=$hash"
  }
}
Write-Host '=== Docker: inventario, solo lectura ==='
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker CLI NO DISPONIBLE. BLOCKED, no se ejecutaron pruebas.' -ForegroundColor Yellow
  exit 0
}
docker version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker daemon no disponible. BLOCKED.' -ForegroundColor Yellow; exit 0 }
docker ps -a --filter 'name=raxi-pg17' --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker images postgres:17 --format '{{.Repository}}:{{.Tag}} {{.ID}}'
Write-Host '=== NOT_VERIFIED: pruebas PG17 todavia NO ejecutadas ===' -ForegroundColor Yellow
Write-Host 'No se detuvieron/crearon contenedores, no se conecto a Supabase y no se ejecuto SQL.'
