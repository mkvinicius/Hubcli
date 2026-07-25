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
try {
    $Version = (& git -C $RepoRoot describe --tags --exact-match --match "hubcli-v*" HEAD 2>$null).Trim()
} catch {}
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
    Set-Content -Path (Join-Path $PkgDir "hubcli.ps1") -Value $Launcher -Encoding utf8

    Remove-Item $Archive -Force -ErrorAction SilentlyContinue
    Push-Location $Stage
    try {
        Compress-Archive -Path $PkgName -DestinationPath $Archive -CompressionLevel Optimal
    } finally {
        Pop-Location
    }
    Write-Output "package-platform.ps1: wrote $Archive"
} finally {
    Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
}
