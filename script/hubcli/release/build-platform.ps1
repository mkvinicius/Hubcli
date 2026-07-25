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
try {
    $Version = (& git -C $RepoRoot describe --tags --exact-match --match "hubcli-v*" HEAD 2>$null).Trim()
} catch {}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $RepoRoot "script/hubcli/VERSION") -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = "local"
}

Write-Output "build-platform.ps1: target=$Target version=$Version"
$env:HUBCLI_VERSION = $Version
& $Bun run --cwd $OpenCodeDir script/build.ts "--target=$Target"
if ($LASTEXITCODE -ne 0) { throw "OpenCode runtime build failed with exit code $LASTEXITCODE" }

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
if ($LASTEXITCODE -ne 0) { throw "hubcli-fast build failed with exit code $LASTEXITCODE" }

Move-Item -Path $RuntimeSource -Destination $RuntimeOutput -Force
Write-Output "build-platform.ps1: done"
Write-Output "  runtime: $RuntimeOutput"
Write-Output "  fast:    $FastOutput"
