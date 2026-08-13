# =============================================================================
# HubCli installer - Windows (PowerShell)
#
#   irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 | iex
#
# To pass options through `irm | iex` (a bare `| iex` cannot forward
# parameters), wrap it in a scriptblock:
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1))) -Check
#
# Downloads a prebuilt platform archive + checksums from the official GitHub
# repository, verifies the SHA-256 checksum, and installs the launcher plus
# binaries atomically. Never touches %USERPROFILE%\.hubcli (config /
# credentials) except to create templates on first install.
#
# Works on Windows PowerShell 5.1 (the version shipped with Windows) and on
# PowerShell 7+.
#
# Parameters:
#   -Version <v>        install a specific version (default: latest release)
#   -InstallDir <dir>   default: %USERPROFILE%\.hubcli\bin
#   -Check              report installed state, change nothing
#   -Repair             reinstall binaries, preserve config
#   -DryRun             print what would happen, change nothing
#   -Uninstall          remove installed binaries (never touches config)
#   -NoPathPrompt       never prompt about PATH (assume no)
#   -Help
#
# Safety:
#   - never accepts API keys as arguments
#   - never requires administrator rights
#   - only downloads from github.com/mkvinicius/Hubcli
#   - aborts (installs nothing) on checksum mismatch
#   - backs up previous binaries before overwriting; rolls back on
#     smoke-test failure
#   - never calls Invoke-Expression on downloaded content
# =============================================================================
param(
    [string]$Version = "",
    [string]$InstallDir = "",
    [switch]$Check,
    [switch]$Repair,
    [switch]$DryRun,
    [switch]$Uninstall,
    [switch]$NoPathPrompt,
    [switch]$Help
)

$Repo = "mkvinicius/Hubcli"
$GitHubApi = "https://api.github.com/repos/$Repo"
$GitHubReleases = "https://github.com/$Repo/releases/download"

# Escape hatch for local testing / air-gapped installs: point at a local
# directory containing hubcli-<target>.zip + checksums-sha256.txt instead of
# GitHub Releases. Mirrors HUBCLI_INSTALL_SOURCE in install.sh.
$SourceDir = $env:HUBCLI_INSTALL_SOURCE

# ---------------------------------------------------------------------------
# Environment fixes that MUST happen before any network call.
#
# 1. $ProgressPreference: Windows PowerShell 5.1 renders a progress bar for
#    every Invoke-WebRequest chunk. On a ~95 MB archive this dominates
#    runtime and makes the download appear to hang for many minutes.
#    Silencing it is the single biggest speed fix on stock Windows.
# 2. TLS: PowerShell 5.1 on older/locked-down Windows still negotiates
#    TLS 1.0/1.1 by default, which GitHub rejects outright ("Could not
#    create SSL/TLS secure channel"). Force TLS 1.2 (and 1.3 when the
#    runtime knows about it).
# ---------------------------------------------------------------------------
$ProgressPreference = "SilentlyContinue"
try {
    $desired = [Net.SecurityProtocolType]::Tls12
    if ([enum]::GetNames([Net.SecurityProtocolType]) -contains "Tls13") {
        $desired = $desired -bor [Net.SecurityProtocolType]::Tls13
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor $desired
} catch {
    # Non-fatal: newer runtimes negotiate modern TLS on their own.
}

# ---------------------------------------------------------------------------
# When this script is run via `irm ... | iex`, a bare `exit` terminates the
# user's entire PowerShell session (closing their window). Everything below
# runs inside a function so we can leave via `return` and surface the outcome
# through $script:ExitCode instead.
# ---------------------------------------------------------------------------
$script:ExitCode = 0

function Write-Info  { param([string]$Message) Write-Host "  - $Message" }
function Write-Ok    { param([string]$Message) Write-Host "  [ok] $Message" -ForegroundColor Green }
function Write-Warn  { param([string]$Message) Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Message) Write-Host "  [x] $Message" -ForegroundColor Red }

function Show-Usage {
    Write-Host "Usage: install.ps1 [-Version <v>] [-InstallDir <dir>] [-Check] [-Repair] [-DryRun] [-Uninstall] [-NoPathPrompt] [-Help]"
    Write-Host ""
    Write-Host "Installs HubCli (github.com/$Repo) without requiring Git or Bun."
    Write-Host "Never pass API keys to this script; add them to %USERPROFILE%\.hubcli\credentials.env after installing."
    Write-Host ""
    Write-Host "Through 'irm | iex', pass options with:"
    Write-Host "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$Repo/dev/install.ps1))) -Check"
}

# Detects the OS architecture, not the architecture of the *current process*.
# A 64-bit Windows running a 32-bit PowerShell host reports
# PROCESSOR_ARCHITECTURE=x86 while PROCESSOR_ARCHITEW6432=AMD64 - reading only
# the former made the installer refuse to run on perfectly supported machines.
function Get-OsArchitecture {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrEmpty($arch)) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ([string]::IsNullOrEmpty($arch)) { return "unknown" }
    return $arch.ToUpperInvariant()
}

function Invoke-HubCliInstall {
    if ($Help) {
        Show-Usage
        return
    }

    # Set only after -Help has been handled: everything below treats a
    # non-terminating error (a failed Copy-Item, Expand-Archive, ...) as fatal
    # so the try/catch and rollback paths actually fire.
    $ErrorActionPreference = "Stop"

    if ([string]::IsNullOrEmpty($InstallDir)) {
        $InstallDir = Join-Path $env:USERPROFILE ".hubcli\bin"
    }
    $HubcliHome = Join-Path $env:USERPROFILE ".hubcli"
    $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

    # -----------------------------------------------------------------------
    # Platform gate
    # -----------------------------------------------------------------------
    $osArch = Get-OsArchitecture
    if ($osArch -in @("AMD64", "X86_64")) {
        $Target = "windows-x64"
    } elseif ($osArch -eq "ARM64") {
        Write-Fail "Windows on ARM64 is not packaged yet (only windows-x64 is built today)."
        Write-Info "Track this in https://github.com/$Repo - or build from source, see docs/INSTALL.md."
        $script:ExitCode = 1
        return
    } else {
        Write-Fail "Unsupported architecture: $osArch (HubCli ships windows-x64 only)."
        $script:ExitCode = 1
        return
    }
    $PkgName = "hubcli-$Target"
    Write-Info "Detected platform: $Target"

    $files = @("hubcli.ps1", "hubcli.cmd", "hubcli-runtime.exe", "hubcli-fast.exe")

    # -----------------------------------------------------------------------
    # Modes that never touch the network
    # -----------------------------------------------------------------------
    if ($Uninstall) {
        Write-Info "Uninstalling HubCli binaries from $InstallDir"
        foreach ($bin in $files) {
            $p = Join-Path $InstallDir $bin
            if (Test-Path $p) {
                Remove-Item $p -Force
                Write-Ok "Removed $p"
            }
        }
        Write-Ok "$HubcliHome (config, credentials, profiles) was left untouched."
        return
    }

    if ($Check) {
        Write-Info "Checking installed HubCli state (no changes)"
        foreach ($bin in @("hubcli.cmd", "hubcli.ps1", "hubcli-runtime.exe", "hubcli-fast.exe")) {
            $p = Join-Path $InstallDir $bin
            if (Test-Path $p) { Write-Ok "present: $p" } else { Write-Warn "missing: $p" }
        }
        foreach ($f in @("opencode.json", "credentials.env")) {
            $p = Join-Path $HubcliHome $f
            if (Test-Path $p) { Write-Ok "present: $p" } else { Write-Warn "missing (optional): $p" }
        }
        return
    }

    # -----------------------------------------------------------------------
    # Dry run: report the plan without touching the network or the filesystem
    # -----------------------------------------------------------------------
    if ($DryRun) {
        $displayVersion = if ([string]::IsNullOrEmpty($Version)) { "<latest release>" } else { $Version }
        Write-Info "(-DryRun) Version: $displayVersion"
        Write-Info "(-DryRun) Would download $PkgName.zip and verify its SHA-256"
        Write-Info "(-DryRun) Would install $($files -join ', ') into $InstallDir"
        Write-Info "(-DryRun) Would create (never overwrite) $HubcliHome\opencode.json and credentials.env"
        return
    }

    # -----------------------------------------------------------------------
    # Resolve version
    # -----------------------------------------------------------------------
    $resolvedVersion = $Version
    if ([string]::IsNullOrEmpty($resolvedVersion)) {
        if (-not [string]::IsNullOrEmpty($SourceDir)) {
            $resolvedVersion = "local"
        } else {
            Write-Info "Resolving latest release..."
            # /releases/latest only returns the newest non-prerelease,
            # non-draft release and 404s while a repo has shipped only
            # prereleases (every hubcli-v*-rc.N so far). Fall back to
            # /releases (all releases, newest first).
            try {
                $release = Invoke-RestMethod -Uri "$GitHubApi/releases/latest" -UseBasicParsing
                $resolvedVersion = $release.tag_name
            } catch {
                try {
                    $releases = Invoke-RestMethod -Uri "$GitHubApi/releases" -UseBasicParsing
                    if ($releases -and @($releases).Count -gt 0) { $resolvedVersion = @($releases)[0].tag_name }
                } catch {
                    $resolvedVersion = $null
                }
            }
            if ([string]::IsNullOrEmpty($resolvedVersion)) {
                Write-Fail "Could not resolve the latest release from GitHub."
                Write-Info "If you are behind a corporate proxy or firewall, download the archive manually:"
                Write-Info "  https://github.com/$Repo/releases"
                Write-Info "Then re-run with -Version <tag>, or see docs/INSTALL.md for the offline path."
                $script:ExitCode = 1
                return
            }
        }
    }
    Write-Info "Version: $resolvedVersion"

    # -----------------------------------------------------------------------
    # Download + verify
    # -----------------------------------------------------------------------
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hubcli-install-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

    try {
        $ArchiveName = "$PkgName.zip"
        $ArchivePath = Join-Path $WorkDir $ArchiveName
        $ChecksumsPath = Join-Path $WorkDir "checksums-sha256.txt"

        if (-not [string]::IsNullOrEmpty($SourceDir)) {
            foreach ($n in @($ArchiveName, "checksums-sha256.txt")) {
                $localSrc = Join-Path $SourceDir $n
                if (-not (Test-Path $localSrc)) {
                    Write-Fail "Local source missing: $localSrc"
                    $script:ExitCode = 1
                    return
                }
                Copy-Item $localSrc (Join-Path $WorkDir $n) -Force
            }
        } else {
            Write-Info "Downloading $ArchiveName (about 95 MB, this can take a minute)..."
            try {
                Invoke-WebRequest -Uri "$GitHubReleases/$resolvedVersion/$ArchiveName" -OutFile $ArchivePath -UseBasicParsing
                Invoke-WebRequest -Uri "$GitHubReleases/$resolvedVersion/checksums-sha256.txt" -OutFile $ChecksumsPath -UseBasicParsing
            } catch {
                Write-Fail "Download failed: $($_.Exception.Message)"
                Write-Info "Check your connection/proxy, or download manually from:"
                Write-Info "  https://github.com/$Repo/releases/tag/$resolvedVersion"
                $script:ExitCode = 1
                return
            }
        }

        $expectedLine = Select-String -Path $ChecksumsPath -Pattern ([regex]::Escape($ArchiveName)) | Select-Object -First 1
        if (-not $expectedLine) {
            Write-Fail "No checksum entry found for $ArchiveName - refusing to install"
            $script:ExitCode = 1
            return
        }
        $expected = (($expectedLine.Line -split "\s+") | Where-Object { $_ })[0]
        $actual = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash
        if ($expected.ToLowerInvariant() -ne $actual.ToLowerInvariant()) {
            Write-Fail "Checksum mismatch for $ArchiveName. Nothing was installed."
            Write-Info "expected $($expected.ToLowerInvariant())"
            Write-Info "got      $($actual.ToLowerInvariant())"
            $script:ExitCode = 1
            return
        }
        Write-Ok "Checksum verified: $ArchiveName"

        # -------------------------------------------------------------------
        # Extract, back up, install
        # -------------------------------------------------------------------
        Expand-Archive -Path $ArchivePath -DestinationPath $WorkDir -Force
        $Extracted = Join-Path $WorkDir $PkgName
        if (-not (Test-Path $Extracted)) {
            Write-Fail "Unexpected archive layout: $Extracted not found"
            $script:ExitCode = 1
            return
        }

        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        New-Item -ItemType Directory -Path $HubcliHome -Force | Out-Null

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
        if ($backupDir) { Write-Info "Backed up previous binaries to $backupDir" }

        foreach ($f in $files) {
            $src = Join-Path $Extracted $f
            if (-not (Test-Path $src)) {
                Write-Fail "Archive is missing $f"
                $script:ExitCode = 1
                return
            }
            Copy-Item $src (Join-Path $InstallDir $f) -Force
        }
        # Windows marks files downloaded from the internet with a
        # Zone.Identifier stream; without stripping it SmartScreen can block
        # the extracted executables on some corporate machines.
        foreach ($f in $files) {
            Unblock-File -Path (Join-Path $InstallDir $f) -ErrorAction SilentlyContinue
        }
        Write-Ok "Installed $($files -join ', ') to $InstallDir"

        # -------------------------------------------------------------------
        # Config - created once, never overwritten
        # -------------------------------------------------------------------
        $cfg = Join-Path $HubcliHome "opencode.json"
        if (-not (Test-Path $cfg)) {
            '{ "$schema": "https://opencode.ai/config.json" }' | Set-Content -Path $cfg -Encoding UTF8
            Write-Ok "Created $cfg"
        } else {
            Write-Ok "$cfg preserved"
        }

        $creds = Join-Path $HubcliHome "credentials.env"
        if (-not (Test-Path $creds)) {
            $credentialTemplate = @"
# HubCli credentials - never share this file.
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
NVIDIA_API_KEY=
"@
            Set-Content -Path $creds -Value $credentialTemplate -Encoding UTF8
            Write-Ok "Created $creds (empty template)"
        } else {
            Write-Ok "$creds preserved"
        }

        # -------------------------------------------------------------------
        # Smoke test - rollback on failure
        # -------------------------------------------------------------------
        $launcher = Join-Path $InstallDir "hubcli.cmd"
        $smokeOutput = $null
        $smokeOk = $true
        try {
            $smokeOutput = & $launcher --version 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($smokeOutput)) { $smokeOk = $false }
        } catch {
            $smokeOk = $false
            $smokeOutput = $_.Exception.Message
        }

        if (-not $smokeOk) {
            Write-Fail "Smoke test failed (hubcli --version). Rolling back."
            if ($smokeOutput) { Write-Info "output: $($smokeOutput.Trim())" }
            if ($backupDir) {
                foreach ($f in $files) {
                    $b = Join-Path $backupDir $f
                    if (Test-Path $b) { Copy-Item $b (Join-Path $InstallDir $f) -Force }
                }
                Write-Warn "Restored previous binaries from $backupDir"
            } else {
                foreach ($f in $files) { Remove-Item (Join-Path $InstallDir $f) -Force -ErrorAction SilentlyContinue }
                Write-Warn "Removed the failed install (no previous version to restore)"
            }
            $script:ExitCode = 1
            return
        }
        Write-Ok "Smoke test passed: $($smokeOutput.Trim())"

        # -------------------------------------------------------------------
        # PATH
        # -------------------------------------------------------------------
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ([string]::IsNullOrEmpty($userPath)) { $userPath = "" }
        $onPath = ($userPath -split ";" | Where-Object { $_.TrimEnd("\") -ieq $InstallDir.TrimEnd("\") }).Count -gt 0

        if ($onPath) {
            Write-Ok "$InstallDir is already on your user PATH."
        } else {
            $addToPath = $false
            if ($NoPathPrompt) {
                $addToPath = $false
            } elseif ([Environment]::UserInteractive) {
                Write-Host ""
                $answer = Read-Host "Add $InstallDir to your user PATH? [Y/n]"
                $addToPath = ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[yY]')
            }

            if ($addToPath) {
                $newPath = if ($userPath.TrimEnd(";")) { "$($userPath.TrimEnd(';'));$InstallDir" } else { $InstallDir }
                [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
                Write-Ok "Added to your user PATH."
            } else {
                Write-Warn "$InstallDir is not on your PATH."
                Write-Info "Add it permanently with:"
                Write-Host "      [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';$InstallDir', 'User')"
            }
        }

        # Always make the command usable in the *current* session, whether or
        # not the persistent PATH was changed - otherwise `hubcli` appears
        # "not found" immediately after a successful install.
        if (($env:Path -split ";" | Where-Object { $_.TrimEnd("\") -ieq $InstallDir.TrimEnd("\") }).Count -eq 0) {
            $env:Path = "$env:Path;$InstallDir"
        }

        Write-Host ""
        Write-Ok "HubCli installed. Try:"
        Write-Host "      hubcli --version"
        Write-Host "      hubcli doctor"
        Write-Host "      hubcli auth status"
        Write-Host ""
        Write-Info "If 'hubcli' is not found in a NEW terminal, restart it so the PATH change applies."
    } finally {
        Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
    }
}

Invoke-HubCliInstall

# Always publish an explicit exit code: without this, $LASTEXITCODE keeps
# whatever the last native command happened to set, so a caller checking it
# after a successful run could read a stale non-zero value.
$global:LASTEXITCODE = $script:ExitCode

if ($script:ExitCode -ne 0) {
    # Fail loudly for a real `powershell -File install.ps1`, but do not call
    # `exit` when this was pasted through `irm | iex` - that would terminate
    # the user's whole PowerShell session instead of just the install.
    if ($PSCommandPath) { exit $script:ExitCode }
    Write-Error "HubCli install failed (exit code $($script:ExitCode))."
}
