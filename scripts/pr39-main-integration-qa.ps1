# PR39: Windows PowerShell 5.1 offline integration QA against a pinned main.
# Worktree is disposable and detached. Does NOT merge/commit/push to main,
# execute Docker/SQL, deploy, use Supabase or enable providers.
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedPrSha
)
$ErrorActionPreference = 'Stop'
$expectedMain = 'e0bea6bb296f2f1aec0439648e9e60ddc186f3e8'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$id = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$temp = Join-Path "$HOME\source" "RaxiHQ-PR39-INTEGRATION-$id"
$made = $false

function CheckExit([string]$label) {
    if ($LASTEXITCODE -ne 0) {
        throw "PR39 INTEGRATION STOP: $label (exit $LASTEXITCODE)"
    }
}
function NodeTest([string]$file) {
    & node $file
    CheckExit "node $file"
}

try {
    if (Test-Path -LiteralPath $temp) { throw 'PR39 INTEGRATION STOP: temporary path already exists' }
    $dirty = @(& git -C $repo status --porcelain)
    CheckExit 'git status'
    if ($dirty.Count -gt 0) { throw 'PR39 INTEGRATION STOP: original PR checkout is dirty' }

    & git -C $repo fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main' '+refs/pull/39/head:refs/remotes/origin/validation-pr39'
    CheckExit 'fetch pinned refs'

    $mainSha = (& git -C $repo rev-parse refs/remotes/origin/main).Trim()
    CheckExit 'resolve main SHA'
    $prSha = (& git -C $repo rev-parse refs/remotes/origin/validation-pr39).Trim()
    CheckExit 'resolve PR SHA'
    if ($mainSha -ne $expectedMain -or $prSha -ne $ExpectedPrSha) {
        throw "PR39 INTEGRATION STOP: target SHA moved; main=$mainSha PR=$prSha"
    }

    & git -C $repo worktree add --detach $temp $expectedMain
    CheckExit 'create disposable main worktree'
    $made = $true

    # Merge only in the disposable DETACHED worktree; --no-commit never
    # creates a merge commit, updates main or pushes a branch.
    & git -C $temp -c "core.hooksPath=$temp\not-a-hook-directory" merge --no-commit --no-ff $ExpectedPrSha
    CheckExit 'conflict-free staged integration tree'
    $newPaths = @(& git -C $temp diff --cached --name-only --diff-filter=A)
    CheckExit 'new PR paths'
    $changedPaths = @(& git -C $temp diff --cached --name-only --diff-filter=DMRTUXB)
    CheckExit 'modified/deleted preexisting paths'
    if ($newPaths.Count -ne 21 -or $changedPaths.Count -ne 0) {
        throw "PR39 INTEGRATION STOP: unexpected integration delta (added=$($newPaths.Count), changed=$($changedPaths.Count))"
    }
    Write-Host "PASS: PR39 MAIN INTEGRATION TREE ($($newPaths.Count) new files, zero conflicts, no modified main files)"

    Push-Location $temp
    try {
        NodeTest 'scripts/test-pr39-local-docker-guard.mjs'
        NodeTest 'scripts/test-pr39-local-recovery.mjs'
        NodeTest 'scripts/test-pr39-pg17-conbin-extractor.mjs'
        NodeTest 'scripts/test-pr39-pg17-oid-binding-resolver.mjs'
        NodeTest 'scripts/test-pr39-slug-structure-proposal.mjs'
        NodeTest 'scripts/test-pr39-pg17-structural-attestation.mjs'
        NodeTest 'scripts/pr39-local-synthetic-recovery.mjs'

        # Installing only from an existing local npm cache. Never call an
        # unpinned registry or run third-party postinstall scripts.
        & npm --prefix apps/raxi-hq ci --offline --ignore-scripts --no-audit --no-fund
        CheckExit 'offline npm ci; if cache unavailable, QA is INCOMPLETE'
        & npm --prefix apps/raxi-hq test
        CheckExit 'app tests on integrated main'
        & npm --prefix apps/raxi-hq run typecheck
        CheckExit 'typecheck on integrated main'
        & npm --prefix apps/raxi-hq run build
        CheckExit 'build on integrated main'
        # security-scan.mjs scans '.'; its intended scope is the application.
        Push-Location (Join-Path $temp 'apps\raxi-hq')
        try {
            & node scripts/security-scan.mjs
            CheckExit 'security scan on integrated main'
        }
        finally { Pop-Location }
        & git diff --cached --check
        CheckExit 'merged staged diff whitespace'
        Write-Host 'PASS: PR39 MAIN INTEGRATION OFFLINE QA, APP TEST, TYPECHECK, BUILD, SECURITY SCAN'
    }
    finally { Pop-Location }
}
finally {
    Set-Location $repo
    if ($made) {
        & git -C $repo worktree remove --force $temp
        if ($LASTEXITCODE -eq 0) { Write-Host 'CLEANUP PASS: disposable integration worktree only' }
        else { Write-Warning "PR39 CLEANUP WARNING: inspect disposable path $temp" }
    }
}
