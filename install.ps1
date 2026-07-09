# =============================================================================
# HubCli installer — Windows (PowerShell)
#
#   irm https://github.com/mkvinicius/Hubcli/releases/latest/download/install.ps1 | iex
#
# AUTHORED-BUT-NOT-EXECUTED: no Windows machine was available in the session
# that wrote this script. It mirrors install.sh's logic (detect arch,
# download from the official GitHub repo only, verify SHA-256, atomic
# install with backup/rollback, never touch existing config/credentials)
# using PowerShell-native equivalents throughout. Treat as unverified until
# it has actually been run and smoke-tested on Windows — see docs/WINDOWS.md.
#
# The `irm ... | iex` command above is just the delivery mechanism (fetches
# this file and executes it). This script itself does not call
# Invoke-Expression on anything it downloads, and does not build commands
# by string interpolation.
#
# Parameters:
#   -Version <v>        install a specific version (default: latest release)
#   -InstallDir <dir>   default: $env:USERPROFILE\.hubcli\bin
#   -Check              report installed state, change nothing
#   -Repair             reinstall binaries, preserve config
#   -DryRun             print what would happen, change nothing
#   -Uninstall          remove installed binaries (never touches config)
#   -Help
# =============================================================================
[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$InstallDir = "",
    [switch]$Check,
    [switch]$Repair,
    [switch]$DryRun,
    [switch]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$Repo = "mkvinicius/Hubcli"
$GitHubApi = "https://api.github.com/repos/$Repo"
$GitHubReleases = "https://github.com/$Repo/releases/download"

if ($Help) {
    Write-Output "Usage: install.ps1 [-Version <v>] [-InstallDir <dir>] [-Check] [-Repair] [-DryRun] [-Uninstall] [-Help]"
    Write-Output "Installs HubCli (github.com/$Repo) without requiring Git or Bun."
    Write-Output "Never pass API keys to this script; add them to `$env:USERPROFILE\.hubcli\credentials.env after installing."
    exit 0
}

if ([string]::IsNullOrEmpty($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE ".hubcli\bin"
}
$HubcliHome = Join-Path $env:USERPROFILE ".hubcli"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# x64 only for the first Windows release — arm64 Windows is not one of the
# targets this build layer produces yet (see build-platform.sh).
if ([System.Environment]::Is64BitOperatingSystem -eq $false) {
    Write-Error "HubCli requires a 64-bit Windows (x64). Unsupported OS."
    exit 1
}
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "x86_64")) {
    Write-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE (only x64 is packaged today)"
    exit 1
}

$Target = "windows-x64"
$PkgName = "hubcli-$Target"

if ($Uninstall) {
    Write-Output "Uninstalling HubCli binaries from $InstallDir"
    foreach ($bin in @("hubcli.ps1", "hubcli.cmd", "hubcli-runtime.exe", "hubcli-fast.exe")) {
        $p = Join-Path $InstallDir $bin
        if (Test-Path $p) {
            Remove-Item $p -Force
            Write-Output "  Removed $p"
        }
    }
    Write-Output "$HubcliHome (config, credentials, profiles) was left untouched."
    exit 0
}

if ($Check) {
    Write-Output "Checking installed HubCli state (no changes)"
    foreach ($bin in @("hubcli.ps1", "hubcli-runtime.exe", "hubcli-fast.exe")) {
        $p = Join-Path $InstallDir $bin
        if (Test-Path $p) { Write-Output "  OK: $p" } else { Write-Output "  MISSING: $p" }
    }
    $cfg = Join-Path $HubcliHome "opencode.json"
    if (Test-Path $cfg) { Write-Output "  OK: $cfg" } else { Write-Output "  MISSING (optional): $cfg" }
    exit 0
}

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($Version)) {
    Write-Output "Resolving latest release..."
    try {
        $release = Invoke-RestMethod -Uri "$GitHubApi/releases/latest"
        $Version = $release.tag_name
    } catch {
        Write-Error "Could not resolve the latest release from GitHub. Pass -Version explicitly."
        exit 1
    }
}
Write-Output "Version: $Version"

# ---------------------------------------------------------------------------
# Download archive + checksums (official repo only), verify SHA-256
# ---------------------------------------------------------------------------
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hubcli-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $WorkDir | Out-Null

try {
    $ArchiveName = "$PkgName.zip"
    $ArchivePath = Join-Path $WorkDir $ArchiveName
    $ChecksumsPath = Join-Path $WorkDir "checksums-sha256.txt"

    Write-Output "Downloading $GitHubReleases/$Version/$ArchiveName"
    Invoke-WebRequest -Uri "$GitHubReleases/$Version/$ArchiveName" -OutFile $ArchivePath
    Invoke-WebRequest -Uri "$GitHubReleases/$Version/checksums-sha256.txt" -OutFile $ChecksumsPath

    $expectedLine = Select-String -Path $ChecksumsPath -Pattern ([regex]::Escape($ArchiveName)) | Select-Object -First 1
    if (-not $expectedLine) {
        Write-Error "No checksum entry found for $ArchiveName in checksums-sha256.txt — refusing to install"
        exit 1
    }
    $expected = ($expectedLine.Line -split "\s+")[0]
    $actual = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
        Write-Error "Checksum mismatch for $ArchiveName (expected $expected, got $actual). Nothing was installed."
        exit 1
    }
    Write-Output "Checksum verified: $ArchiveName"

    if ($DryRun) {
        Write-Output "(-DryRun) Would install hubcli.ps1, hubcli.cmd, hubcli-runtime.exe, hubcli-fast.exe into $InstallDir"
        exit 0
    }

    # -----------------------------------------------------------------------
    # Extract, back up existing binaries, install atomically
    # -----------------------------------------------------------------------
    Expand-Archive -Path $ArchivePath -DestinationPath $WorkDir -Force
    $Extracted = Join-Path $WorkDir $PkgName
    if (-not (Test-Path $Extracted)) {
        Write-Error "Unexpected archive layout: $Extracted not found"
        exit 1
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    New-Item -ItemType Directory -Path $HubcliHome -Force | Out-Null

    $files = @("hubcli.ps1", "hubcli.cmd", "hubcli-runtime.exe", "hubcli-fast.exe")
    $backupDir = $null
    foreach ($f in $files) {
        $existing = Join-Path $InstallDir $f
        if (Test-Path $existing) {
            if (-not $backupDir) {
                $backupDir = Join-Path $InstallDir ".hubcli-backup-$Timestamp"
                New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
            }
            Copy-Item $existing (Join-Path $backupDir $f) -Force
        }
    }
    if ($backupDir) { Write-Output "Backed up previous binaries to $backupDir" }

    foreach ($f in $files) {
        $src = Join-Path $Extracted $f
        if (-not (Test-Path $src)) {
            Write-Error "Archive is missing $f"
            exit 1
        }
        Copy-Item $src (Join-Path $InstallDir $f) -Force
    }
    Write-Output "Installed hubcli.ps1, hubcli.cmd, hubcli-runtime.exe, hubcli-fast.exe to $InstallDir"

    # -----------------------------------------------------------------------
    # Config — created once, never overwritten
    # -----------------------------------------------------------------------
    $cfg = Join-Path $HubcliHome "opencode.json"
    if (-not (Test-Path $cfg)) {
        '{ "$schema": "https://opencode.ai/config.json" }' | Set-Content -Path $cfg
        Write-Output "Created $cfg"
    } else {
        Write-Output "$cfg preserved"
    }

    $creds = Join-Path $HubcliHome "credentials.env"
    if (-not (Test-Path $creds)) {
        @"
# HubCli credentials — never share this file.
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
NVIDIA_API_KEY=
"@ | Set-Content -Path $creds
        Write-Output "Created $creds (empty template)"
    } else {
        Write-Output "$creds preserved"
    }

    # -----------------------------------------------------------------------
    # Smoke test — rollback on failure
    # -----------------------------------------------------------------------
    $launcher = Join-Path $InstallDir "hubcli.cmd"
    $smokeOk = $true
    try {
        $v = & $launcher --version
        if ([string]::IsNullOrEmpty($v)) { $smokeOk = $false }
    } catch {
        $smokeOk = $false
    }

    if (-not $smokeOk) {
        Write-Error "Smoke test failed (hubcli --version). Rolling back."
        if ($backupDir) {
            foreach ($f in $files) {
                $b = Join-Path $backupDir $f
                if (Test-Path $b) { Copy-Item $b (Join-Path $InstallDir $f) -Force }
            }
            Write-Warning "Restored previous binaries from $backupDir"
        } else {
            foreach ($f in $files) { Remove-Item (Join-Path $InstallDir $f) -Force -ErrorAction SilentlyContinue }
            Write-Warning "Removed the failed install (no previous version to restore)"
        }
        exit 1
    }
    Write-Output "Smoke test passed: $v"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$InstallDir*") {
        Write-Output ""
        Write-Output "$InstallDir is not on your user PATH."
        $answer = Read-Host "Add it now? [y/N]"
        if ($answer -eq "y" -or $answer -eq "Y") {
            [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
            Write-Output "Added. Restart your terminal for it to take effect."
        } else {
            Write-Output "Skipped. Add manually: `$env:Path += ';$InstallDir'`"
        }
    } else {
        Write-Output "$InstallDir is already on PATH."
    }

    Write-Output ""
    Write-Output "HubCli installed. Try:"
    Write-Output "  hubcli --version"
    Write-Output "  hubcli doctor"
    Write-Output "  hubcli auth status"
} finally {
    Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
}
