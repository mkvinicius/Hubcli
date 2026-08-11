[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("windows-x64")]
    [string]$Target
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../../..")).Path
$OpenCodeDir = Join-Path $RepoRoot "packages/opencode"
$Bun = (Get-Command bun -ErrorAction Stop).Source

$Version = ""
$VersionTags = @(& git -C $RepoRoot tag --points-at HEAD --list "hubcli-v*")
$GitExitCode = $LASTEXITCODE
if ($GitExitCode -ne 0) {
    throw "Version tag lookup failed with exit code $GitExitCode"
}
if ($VersionTags.Count -gt 0) {
    $Version = $VersionTags[0].Trim()
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $RepoRoot "script/hubcli/VERSION") -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = "local"
}

Write-Output "build-platform.ps1: target=$Target version=$Version"
$env:HUBCLI_VERSION = $Version
& $Bun run --cwd $OpenCodeDir script/build.ts "--target=$Target"
$RuntimeBuildExitCode = $LASTEXITCODE
if ($RuntimeBuildExitCode -ne 0) { throw "OpenCode runtime build failed with exit code $RuntimeBuildExitCode" }

$BuildDir = Join-Path $OpenCodeDir "dist/opencode-$Target/bin"
$RuntimeSource = Join-Path $BuildDir "opencode.exe"
$RuntimeOutput = Join-Path $BuildDir "hubcli-runtime.exe"
$FastEntry = Join-Path $OpenCodeDir "src/cli/hubcli/fast.ts"
$FastOutput = Join-Path $BuildDir "hubcli-fast.exe"

if (-not (Test-Path $RuntimeSource -PathType Leaf)) {
    throw "Expected runtime binary not found: $RuntimeSource"
}

Write-Output "build-platform.ps1: building hubcli-fast ($Target)..."
& $Bun build --compile --minify --conditions=browser --target=bun-windows-x64 "--outfile=$FastOutput" $FastEntry
$FastBuildExitCode = $LASTEXITCODE
if ($FastBuildExitCode -ne 0) { throw "hubcli-fast build failed with exit code $FastBuildExitCode" }

Move-Item -Path $RuntimeSource -Destination $RuntimeOutput -Force
Write-Output "build-platform.ps1: done"
Write-Output "  runtime: $RuntimeOutput"
Write-Output "  fast:    $FastOutput"

# GitHub's pwsh wrapper exits with the final native-process status.
# Every native process above has been checked, so clear only validated state.
$global:LASTEXITCODE = 0
