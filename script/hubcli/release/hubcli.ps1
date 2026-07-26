# hubcli.ps1 - Windows launcher for the distributed HubCli package.
#
# Mirrors script/hubcli/launcher-template.sh (macOS/Linux): whitelist-only
# credential loading (no Invoke-Expression on file contents), HUBCLI_DEV
# awareness, and argument/exit-code passthrough. Packaging tests parse it
# with Windows PowerShell and PowerShell 7 before Windows CI executes it.

$ErrorActionPreference = "Stop"

$HubcliBinDir = $PSScriptRoot
$HubcliHome = Join-Path $env:USERPROFILE ".hubcli"
$HubcliCreds = Join-Path $HubcliHome "credentials.env"
$HubcliVersion = "__HUBCLI_VERSION__"
$RuntimeExe = Join-Path $HubcliBinDir "hubcli-runtime.exe"
$FastExe = Join-Path $HubcliBinDir "hubcli-fast.exe"
$OriginalPwd = (Get-Location).Path

# ---------------------------------------------------------------------------
# --version / -v short-circuit - HUBCLI_DEV is not meaningful for a
# distributed Windows install (no TypeScript source is shipped), so unlike
# the POSIX launcher this always reports the installed version.
# ---------------------------------------------------------------------------
if ($args.Count -eq 1 -and ($args[0] -eq "--version" -or $args[0] -eq "-v")) {
    Write-Output $HubcliVersion
    exit 0
}

# ---------------------------------------------------------------------------
# Secure credential loader - no Invoke-Expression, no dot-sourcing of the
# file. Whitelist-only parser, same three variables as the POSIX launcher.
# Does not override variables already set in the calling environment.
# ---------------------------------------------------------------------------
if (Test-Path $HubcliCreds) {
    $allowed = @("DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "NVIDIA_API_KEY")
    foreach ($line in Get-Content $HubcliCreds) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrEmpty($trimmed) -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 0) { continue }
        $name = $trimmed.Substring(0, $idx)
        $value = $trimmed.Substring($idx + 1)
        if ($allowed -notcontains $name) {
            Write-Warning "hubcli: credentials.env: unknown variable '$name', ignoring"
            continue
        }
        if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name)) -and -not [string]::IsNullOrEmpty($value)) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

if (-not (Test-Path $RuntimeExe)) {
    Write-Error "hubcli: runtime binary not found at $RuntimeExe (installation may be corrupt; try repair)"
    exit 1
}

$env:HUBCLI_BRAND = "1"
$env:HUBCLI_VERSION = $HubcliVersion
$env:HUBCLI_CALLER_PWD = $OriginalPwd
$env:OPENCODE_CONFIG_DIR = $HubcliHome

& $RuntimeExe @args
exit $LASTEXITCODE
