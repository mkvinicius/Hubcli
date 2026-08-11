[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("windows-x64")]
    [string]$Target,

    [Parameter(Mandatory = $true)]
    [string]$OutDir
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../../..")).Path
$BuildDir = Join-Path $RepoRoot "packages/opencode/dist/opencode-$Target/bin"
$RuntimeBin = Join-Path $BuildDir "hubcli-runtime.exe"
$FastBin = Join-Path $BuildDir "hubcli-fast.exe"

foreach ($file in @($RuntimeBin, $FastBin)) {
    if (-not (Test-Path $file -PathType Leaf)) {
        throw "package-platform.ps1: missing build output: $file"
    }
}

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

$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("hubcli-package-" + [Guid]::NewGuid().ToString("N"))
$PkgName = "hubcli-$Target"
$PkgDir = Join-Path $Stage $PkgName
$OutputDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutDir))
$Archive = Join-Path $OutputDir "$PkgName.zip"

try {
    New-Item -ItemType Directory -Path $PkgDir -Force | Out-Null
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    Copy-Item $RuntimeBin (Join-Path $PkgDir "hubcli-runtime.exe")
    Copy-Item $FastBin (Join-Path $PkgDir "hubcli-fast.exe")
    Copy-Item (Join-Path $RepoRoot "LICENSE") (Join-Path $PkgDir "LICENSE")
    Copy-Item (Join-Path $ScriptDir "hubcli.cmd") (Join-Path $PkgDir "hubcli.cmd")

    $Readme = Get-Content (Join-Path $ScriptDir "README.txt.tmpl") -Raw
    $Readme = $Readme.Replace("__HUBCLI_VERSION__", $Version).Replace("__HUBCLI_TARGET__", $Target)
    Set-Content -Path (Join-Path $PkgDir "README.txt") -Value $Readme -Encoding utf8

    $Launcher = Get-Content (Join-Path $ScriptDir "hubcli.ps1") -Raw
    $Launcher = $Launcher.Replace("__HUBCLI_VERSION__", $Version)
    $LauncherPath = Join-Path $PkgDir "hubcli.ps1"
    [System.IO.File]::WriteAllText($LauncherPath, $Launcher, [System.Text.UTF8Encoding]::new($false))

    $NonAsciiBytes = [System.IO.File]::ReadAllBytes($LauncherPath) | Where-Object { $_ -gt 0x7F }
    if ($NonAsciiBytes.Count -gt 0) {
        throw "package-platform.ps1: generated hubcli.ps1 must contain ASCII bytes only"
    }

    $ParserTokens = $null
    $ParserErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $LauncherPath,
        [ref]$ParserTokens,
        [ref]$ParserErrors
    ) | Out-Null
    if ($ParserErrors.Count -gt 0) {
        $ParserDetails = ($ParserErrors | ForEach-Object {
            "line $($_.Extent.StartLineNumber): $($_.Message)"
        }) -join "; "
        throw "package-platform.ps1: generated hubcli.ps1 has parser errors: $ParserDetails"
    }

    Remove-Item $Archive -Force -ErrorAction SilentlyContinue
    Push-Location $Stage
    try {
        Compress-Archive -Path $PkgName -DestinationPath $Archive -CompressionLevel Optimal
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $Archive -PathType Leaf)) {
        throw "package-platform.ps1: archive was not created: $Archive"
    }
    Write-Output "package-platform.ps1: wrote $Archive"
} finally {
    Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

# GitHub's pwsh wrapper exits with the final native-process status.
# Every native process above has been checked, so clear only validated state.
$global:LASTEXITCODE = 0
