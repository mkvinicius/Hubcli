/**
 * Release packaging and installer tests. POSIX installer execution is scoped
 * to macOS/Linux; checksum parsing and installer security checks are portable.
 */

import { describe, test, expect, afterAll } from "bun:test"
import { execFileSync, spawnSync } from "child_process"
import { createHash } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../..")
const INSTALL_SH = path.join(REPO_ROOT, "install.sh")
const INSTALL_PS1 = path.join(REPO_ROOT, "install.ps1")
const GENERATE_CHECKSUMS = path.join(REPO_ROOT, "script/hubcli/release/generate-checksums.sh")
const SECRET_SCAN = path.join(REPO_ROOT, "script/hubcli/release/scan-secrets.sh")
const BUILD_WINDOWS = path.join(REPO_ROOT, "script/hubcli/release/build-platform.ps1")
const PACKAGE_WINDOWS = path.join(REPO_ROOT, "script/hubcli/release/package-platform.ps1")
const CI_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "hubcli-ci.yml")
const RELEASE_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "hubcli-release.yml")

const isWindows = process.platform === "win32"
const testPosix = isWindows ? test.skip : test
const testWindows = isWindows ? test : test.skip

let tmpDirs: string[] = []
function tmpdir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", env })
    return { stdout, status: 0 }
  } catch (error: any) {
    return {
      stdout: (error.stdout?.toString() ?? "") + (error.stderr?.toString() ?? ""),
      status: error.status ?? 1,
    }
  }
}

function runDetailed(
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8", env })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
    status: result.status ?? 1,
  }
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function createWindowsPackageFixture(initializeGit: boolean): {
  root: string
  packageScript: string
  archive: string
} {
  const root = tmpdir("hubcli-windows-package-")
  const releaseDir = path.join(root, "script", "hubcli", "release")
  const buildDir = path.join(root, "packages", "opencode", "dist", "opencode-windows-x64", "bin")
  fs.mkdirSync(releaseDir, { recursive: true })
  fs.mkdirSync(buildDir, { recursive: true })

  for (const file of ["package-platform.ps1", "hubcli.cmd", "hubcli.ps1", "README.txt.tmpl"]) {
    fs.copyFileSync(path.join(REPO_ROOT, "script", "hubcli", "release", file), path.join(releaseDir, file))
  }
  fs.copyFileSync(path.join(REPO_ROOT, "LICENSE"), path.join(root, "LICENSE"))
  fs.copyFileSync(path.join(REPO_ROOT, "script", "hubcli", "VERSION"), path.join(root, "script", "hubcli", "VERSION"))
  fs.writeFileSync(path.join(buildDir, "hubcli-runtime.exe"), "fixture runtime\n")
  fs.writeFileSync(path.join(buildDir, "hubcli-fast.exe"), "fixture fast path\n")

  if (initializeGit) {
    for (const args of [
      ["init"],
      ["config", "user.email", "hubcli-tests@example.invalid"],
      ["config", "user.name", "HubCli Tests"],
      ["add", "."],
      ["commit", "-m", "fixture"],
    ]) {
      const result = runDetailed("git", ["-C", root, ...args])
      if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
      }
    }
  }

  return {
    root,
    packageScript: path.join(releaseDir, "package-platform.ps1"),
    archive: path.join(root, "dist-release", "hubcli-windows-x64.zip"),
  }
}

export function parseChecksumLines(text: string): Map<string, string> {
  const checksums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/i)
    if (!match) throw new Error(`Invalid checksum line: ${line}`)
    checksums.set(match[2], match[1].toLowerCase())
  }
  return checksums
}

function installShTarget(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "win32") return null
  if (arch !== "x64" && arch !== "arm64") return null
  if (platform === "darwin") return `darwin-${arch}`
  if (platform === "linux") return `linux-${arch}`
  return null
}

function currentInstallShTarget(): string | null {
  return installShTarget(process.platform, process.arch)
}

function requireInstallShTarget(): string {
  const target = currentInstallShTarget()
  if (!target) {
    throw new Error(`install.sh has no package target for ${process.platform}/${process.arch}`)
  }
  return target
}

// Builds a real tar.gz with tiny placeholder executables, allowing the local
// install.sh path to be tested without cross-compiling the application.
function buildFakePackage(dir: string, target: string): string {
  const pkgName = `hubcli-${target}`
  const stage = path.join(dir, pkgName)
  fs.mkdirSync(stage, { recursive: true })
  const launcher =
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "hubcli-vTEST"; exit 0; fi\necho "fake hubcli-runtime"\n'
  fs.writeFileSync(path.join(stage, "hubcli"), launcher)
  fs.writeFileSync(path.join(stage, "hubcli-runtime"), launcher)
  fs.writeFileSync(path.join(stage, "hubcli-fast"), launcher)
  fs.writeFileSync(path.join(stage, "LICENSE"), "MIT")
  fs.writeFileSync(path.join(stage, "README.txt"), "fake package for tests")
  for (const file of ["hubcli", "hubcli-runtime", "hubcli-fast"]) {
    fs.chmodSync(path.join(stage, file), 0o755)
  }
  const archive = path.join(dir, `${pkgName}.tar.gz`)
  execFileSync("tar", ["-C", dir, "-czf", archive, pkgName])
  return archive
}

function assertInstallFixture(sourceDir: string, target: string): void {
  const archiveName = `hubcli-${target}.tar.gz`
  const available = fs.readdirSync(sourceDir).sort()
  expect(
    fs.existsSync(path.join(sourceDir, archiveName)),
    `Detected target ${target}; expected ${archiveName}; available files: ${available.join(", ")}`,
  ).toBe(true)

  const checksumFile = path.join(sourceDir, "checksums-sha256.txt")
  expect(
    fs.existsSync(checksumFile),
    `Detected target ${target}; checksums-sha256.txt is missing; available files: ${available.join(", ")}`,
  ).toBe(true)
  const checksums = parseChecksumLines(fs.readFileSync(checksumFile, "utf8"))
  expect(
    checksums.has(archiveName),
    `Detected target ${target}; checksum entry for ${archiveName} is missing; entries: ${[
      ...checksums.keys(),
    ].join(", ")}`,
  ).toBe(true)
}

describe("generate-checksums.sh", () => {
  test("parses both GNU text and binary checksum markers", () => {
    const a = "a".repeat(64)
    const b = "b".repeat(64)
    const parsed = parseChecksumLines(`${a}  install.sh\r\n${b} *hubcli-windows-x64.zip\n`)
    expect(parsed.get("install.sh")).toBe(a)
    expect(parsed.get("hubcli-windows-x64.zip")).toBe(b)
  })

  testPosix("writes canonical filename-to-sha pairs for every archive/installer", () => {
    const dir = tmpdir("hubcli-checksums-")
    fs.writeFileSync(path.join(dir, "hubcli-darwin-x64.tar.gz"), "fake archive contents")
    fs.writeFileSync(path.join(dir, "install.sh"), "fake installer")
    const { status } = run("bash", [GENERATE_CHECKSUMS, dir])
    expect(status).toBe(0)

    const checksums = parseChecksumLines(fs.readFileSync(path.join(dir, "checksums-sha256.txt"), "utf8"))
    expect(checksums.get("hubcli-darwin-x64.tar.gz")).toBe(
      sha256(path.join(dir, "hubcli-darwin-x64.tar.gz")),
    )
    expect(checksums.get("install.sh")).toBe(sha256(path.join(dir, "install.sh")))
  })
})

describe("install.sh (local source, no network)", () => {
  test("maps OS and architecture exactly like the installer", () => {
    expect(installShTarget("darwin", "x64")).toBe("darwin-x64")
    expect(installShTarget("darwin", "arm64")).toBe("darwin-arm64")
    expect(installShTarget("linux", "x64")).toBe("linux-x64")
    expect(installShTarget("linux", "arm64")).toBe("linux-arm64")
    expect(installShTarget("win32", "x64")).toBeNull()
    expect(installShTarget("linux", "ia32")).toBeNull()
  })

  testPosix("valid checksum: installs, smoke test passes, binaries present", () => {
    const target = requireInstallShTarget()
    const sourceDir = tmpdir("hubcli-install-src-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])
    assertInstallFixture(sourceDir, target)

    const fakeHome = tmpdir("hubcli-install-home-")
    const binDir = path.join(fakeHome, "bin")
    const { stdout, status } = run("bash", [INSTALL_SH, "--version", "hubcli-vTEST"], {
      ...process.env,
      HOME: fakeHome,
      HUBCLI_BIN_DIR: binDir,
      HUBCLI_INSTALL_SOURCE: sourceDir,
    })
    expect(status).toBe(0)
    expect(stdout).toContain("Checksum verified")
    expect(stdout).toContain("Smoke test passed")
    expect(fs.existsSync(path.join(binDir, "hubcli"))).toBe(true)
    expect(fs.existsSync(path.join(fakeHome, ".hubcli", "credentials.env"))).toBe(true)
    const credsPerms = fs.statSync(path.join(fakeHome, ".hubcli", "credentials.env")).mode & 0o777
    expect(credsPerms).toBe(0o600)
  })

  testPosix("checksum mismatch: aborts, installs nothing", () => {
    const target = requireInstallShTarget()
    const sourceDir = tmpdir("hubcli-install-badsrc-")
    buildFakePackage(sourceDir, target)
    fs.writeFileSync(
      path.join(sourceDir, "checksums-sha256.txt"),
      `${"0".repeat(64)}  hubcli-${target}.tar.gz\n`,
    )
    assertInstallFixture(sourceDir, target)

    const fakeHome = tmpdir("hubcli-install-badhome-")
    const binDir = path.join(fakeHome, "bin")
    const { stdout, status } = run("bash", [INSTALL_SH, "--version", "hubcli-vTEST"], {
      ...process.env,
      HOME: fakeHome,
      HUBCLI_BIN_DIR: binDir,
      HUBCLI_INSTALL_SOURCE: sourceDir,
    })
    expect(status).not.toBe(0)
    expect(stdout).toContain("Checksum mismatch")
    expect(fs.existsSync(binDir)).toBe(false)
  })

  testPosix("--repair preserves existing credentials.env content", () => {
    const target = requireInstallShTarget()
    const sourceDir = tmpdir("hubcli-install-repairsrc-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])
    assertInstallFixture(sourceDir, target)

    const fakeHome = tmpdir("hubcli-install-repairhome-")
    const binDir = path.join(fakeHome, "bin")
    const env = { ...process.env, HOME: fakeHome, HUBCLI_BIN_DIR: binDir, HUBCLI_INSTALL_SOURCE: sourceDir }
    run("bash", [INSTALL_SH, "--version", "hubcli-vTEST"], env)

    const credsPath = path.join(fakeHome, ".hubcli", "credentials.env")
    fs.appendFileSync(credsPath, "DEEPSEEK_API_KEY=user-added-value\n")
    const { status } = run("bash", [INSTALL_SH, "--repair", "--version", "hubcli-vTEST"], env)
    expect(status).toBe(0)
    expect(fs.readFileSync(credsPath, "utf8")).toContain("user-added-value")
    expect(fs.readdirSync(binDir).some((file) => file.startsWith(".hubcli-backup-"))).toBe(true)
  })

  testPosix("--uninstall removes binaries but never touches ~/.hubcli", () => {
    const target = requireInstallShTarget()
    const sourceDir = tmpdir("hubcli-install-uninstallsrc-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])
    assertInstallFixture(sourceDir, target)

    const fakeHome = tmpdir("hubcli-install-uninstallhome-")
    const binDir = path.join(fakeHome, "bin")
    const env = { ...process.env, HOME: fakeHome, HUBCLI_BIN_DIR: binDir, HUBCLI_INSTALL_SOURCE: sourceDir }
    run("bash", [INSTALL_SH, "--version", "hubcli-vTEST"], env)
    fs.appendFileSync(path.join(fakeHome, ".hubcli", "credentials.env"), "DEEPSEEK_API_KEY=must-survive\n")

    const { status } = run("bash", [INSTALL_SH, "--uninstall"], env)
    expect(status).toBe(0)
    expect(fs.existsSync(path.join(binDir, "hubcli"))).toBe(false)
    expect(fs.readFileSync(path.join(fakeHome, ".hubcli", "credentials.env"), "utf8")).toContain("must-survive")
  })

  testWindows("refuses Windows and points to install.ps1", () => {
    const fakeHome = tmpdir("hubcli-install-windows-home-")
    const { stdout, status } = run("bash", [INSTALL_SH], {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    })
    expect(status).not.toBe(0)
    expect(stdout).toContain("Unsupported OS")
    expect(stdout).toContain("install.ps1")
  })

  test("never accepts an API key as a command-line argument", () => {
    const content = fs.readFileSync(INSTALL_SH, "utf8")
    expect(content).not.toMatch(/--(api-key|token|deepseek-key|nvidia-key)/i)
  })
})

describe("install.ps1", () => {
  test("has checksum, repair and uninstall controls without executable Invoke-Expression", () => {
    const content = fs.readFileSync(INSTALL_PS1, "utf8")
    const executable = content
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#") && line.trim() !== "")
      .join("\n")
    expect(content).toContain("Get-FileHash")
    expect(content).toContain("[switch]$Repair")
    expect(content).toContain("[switch]$Uninstall")
    expect(content).toContain("[switch]$Help")
    expect(executable.startsWith("param(")).toBe(true)
    expect(content).not.toContain("[CmdletBinding()]")
    expect(content.indexOf("if ($Help)")).toBeLessThan(content.indexOf('$ErrorActionPreference = "Stop"'))
    expect(content.indexOf("if ($DryRun)")).toBeLessThan(content.indexOf("Invoke-RestMethod"))
    expect(content).not.toMatch(/^\s*(Invoke-Expression|iex)\b/im)
    expect(content).not.toMatch(/\[(string|securestring)\]\$(ApiKey|Token|DeepseekKey|NvidiaKey)\b/i)
  })

  testWindows("-Help succeeds without network or credentials", () => {
    const { stdout, stderr, status } = runDetailed("pwsh", ["-NoProfile", "-File", INSTALL_PS1, "-Help"])
    if (status !== 0) {
      throw new Error(`install.ps1 -Help exited ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    }
    expect(status).toBe(0)
    expect(stdout).toMatch(/HubCli|install/i)
    expect(stderr).toBe("")
  })

  testWindows("-DryRun succeeds without network or file changes", () => {
    const userProfile = tmpdir("hubcli-powershell-dry-run-")
    const hubcliHome = path.join(userProfile, ".hubcli")
    const binDir = path.join(userProfile, "bin")
    const { stdout, stderr, status } = runDetailed("pwsh", ["-NoProfile", "-File", INSTALL_PS1, "-DryRun"], {
      ...process.env,
      USERPROFILE: userProfile,
      HOME: userProfile,
      HUBCLI_BIN_DIR: binDir,
    })
    if (status !== 0) {
      throw new Error(`install.ps1 -DryRun exited ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    }
    expect(stdout).toContain("no network or file changes")
    expect(stderr).toBe("")
    expect(fs.existsSync(hubcliHome)).toBe(false)
    expect(fs.existsSync(binDir)).toBe(false)

    const hubcliArtifacts: string[] = []
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name)
        if (/^(?:\.hubcli|hubcli(?:[.-].*)?|credentials\.env|opencode\.json|checksums-sha256\.txt)$/i.test(entry.name)) {
          hubcliArtifacts.push(path.relative(userProfile, entryPath))
        }
        if (entry.isDirectory() && !entry.isSymbolicLink()) visit(entryPath)
      }
    }
    visit(userProfile)
    expect(hubcliArtifacts).toEqual([])
  })

  test("Windows build and package scripts use native executables and zip packaging", () => {
    const build = fs.readFileSync(BUILD_WINDOWS, "utf8")
    const packaging = fs.readFileSync(PACKAGE_WINDOWS, "utf8")
    const launcher = fs.readFileSync(path.join(REPO_ROOT, "script", "hubcli", "release", "hubcli.ps1"))
    const posixLauncher = fs.readFileSync(
      path.join(REPO_ROOT, "script", "hubcli", "release", "hubcli-dist-launcher.sh"),
      "utf8",
    )
    expect(build).toContain('[ValidateSet("windows-x64")]')
    expect(build).toContain("--target=bun-windows-x64")
    expect(build).toContain("$RuntimeBuildExitCode = $LASTEXITCODE")
    expect(build).toContain("$FastBuildExitCode = $LASTEXITCODE")
    expect(build).toContain("$global:LASTEXITCODE = 0")
    expect(packaging).toContain("Compress-Archive")
    expect(packaging).toContain("hubcli.cmd")
    expect(packaging).toContain("hubcli.ps1")
    expect(packaging).toContain("$GitExitCode = $LASTEXITCODE")
    expect(packaging).toContain("$global:LASTEXITCODE = 0")
    expect(packaging).toContain("[System.Management.Automation.Language.Parser]::ParseFile")
    expect(packaging).toContain("[System.Text.UTF8Encoding]::new($false)")
    expect([...launcher].every((byte) => byte <= 0x7f)).toBe(true)
    expect(launcher.toString("utf8")).toContain("$env:HUBCLI_LAUNCHER = $LauncherCmd")
    expect(posixLauncher).toContain('HUBCLI_LAUNCHER="${_self}/hubcli"')
  })

  test("Windows package smoke tests use command-specific documented exit codes", () => {
    for (const workflowPath of [CI_WORKFLOW, RELEASE_WORKFLOW]) {
      const workflow = fs.readFileSync(workflowPath, "utf8")
      expect(workflow).toContain('Invoke-HubCliDiagnostic -CommandArgs @("profile", "list") -AllowedExitCodes @(0)')
      expect(workflow).toContain('Invoke-HubCliDiagnostic -CommandArgs @("doctor") -AllowedExitCodes @(0, 1, 2)')
      expect(workflow).toContain(
        'Invoke-HubCliDiagnostic -CommandArgs @("doctor", "--mcp") -AllowedExitCodes @(0, 1, 2, 4)',
      )
      expect(workflow).toContain("Unexpected exit code $code for: hubcli")
      expect(workflow).toContain("$global:LASTEXITCODE = 0")
      expect(workflow).not.toContain("-AllowedExitCodes @(0, 1, 2, 3, 4)")
      expect(workflow).not.toMatch(/AllowedExitCodes[^\n]*(?:99|127)/)
    }
  })

  testWindows("package creation exits 0, contains only release files, and preserves external failures", () => {
    const fixture = createWindowsPackageFixture(true)
    const packaged = runDetailed("pwsh", [
      "-NoProfile",
      "-File",
      fixture.packageScript,
      "-Target",
      "windows-x64",
      "-OutDir",
      "dist-release",
    ])
    if (packaged.status !== 0) {
      throw new Error(`package-platform.ps1 exited ${packaged.status}\nstdout:\n${packaged.stdout}\nstderr:\n${packaged.stderr}`)
    }
    expect(packaged.status).toBe(0)
    expect(fs.existsSync(fixture.archive)).toBe(true)

    const extracted = tmpdir("hubcli-windows-package-extracted-")
    const extractScript = path.join(extracted, "extract.ps1")
    fs.writeFileSync(
      extractScript,
      "param([string]$Archive, [string]$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n",
    )
    const extractDir = path.join(extracted, "contents")
    const expanded = runDetailed("pwsh", [
      "-NoProfile",
      "-File",
      extractScript,
      "-Archive",
      fixture.archive,
      "-Destination",
      extractDir,
    ])
    expect(expanded.status).toBe(0)

    const files = fs
      .readdirSync(extractDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(extractDir, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
      .sort()
    expect(files).toEqual([
      "hubcli-windows-x64/LICENSE",
      "hubcli-windows-x64/README.txt",
      "hubcli-windows-x64/hubcli-fast.exe",
      "hubcli-windows-x64/hubcli-runtime.exe",
      "hubcli-windows-x64/hubcli.cmd",
      "hubcli-windows-x64/hubcli.ps1",
    ])
    expect(files.some((file) => /(^|\/)(?:\.git|node_modules|credentials\.env|auth\.json)(?:\/|$)/i.test(file))).toBe(
      false,
    )

    const packageRoot = path.join(extractDir, "hubcli-windows-x64")
    const launcherPath = path.join(packageRoot, "hubcli.ps1")
    const launcherBytes = fs.readFileSync(launcherPath)
    const sourceLauncher = fs
      .readFileSync(path.join(REPO_ROOT, "script", "hubcli", "release", "hubcli.ps1"), "utf8")
      .replace("__HUBCLI_VERSION__", fs.readFileSync(path.join(REPO_ROOT, "script", "hubcli", "VERSION"), "utf8").trim())
    expect([...launcherBytes].every((byte) => byte <= 0x7f)).toBe(true)
    expect(launcherBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false)
    expect(launcherBytes.toString("utf8")).toBe(sourceLauncher)

    const parserScript = path.join(extracted, "parse-launcher.ps1")
    fs.writeFileSync(
      parserScript,
      [
        "param([string]$Launcher)",
        "$tokens = $null",
        "$errors = $null",
        "[System.Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$tokens, [ref]$errors) | Out-Null",
        "if ($errors.Count -gt 0) { $errors | Format-List; exit 1 }",
      ].join("\n"),
    )
    for (const engine of ["pwsh", "powershell"]) {
      const parsed = runDetailed(engine, ["-NoProfile", "-File", parserScript, "-Launcher", launcherPath])
      if (parsed.status !== 0) {
        throw new Error(`${engine} parser failed\nstdout:\n${parsed.stdout}\nstderr:\n${parsed.stderr}`)
      }
      expect(parsed.status).toBe(0)
    }

    const invokeScript = path.join(extracted, "invoke-launcher.ps1")
    fs.writeFileSync(
      invokeScript,
      "param([string]$Launcher)\n& $Launcher --version\nexit $LASTEXITCODE\n",
    )
    const invoked = runDetailed("pwsh", [
      "-NoProfile",
      "-File",
      invokeScript,
      "-Launcher",
      path.join(packageRoot, "hubcli.cmd"),
    ])
    if (invoked.status !== 0) {
      throw new Error(`packaged hubcli.cmd failed\nstdout:\n${invoked.stdout}\nstderr:\n${invoked.stderr}`)
    }
    expect(invoked.stdout).toContain(fs.readFileSync(path.join(REPO_ROOT, "script", "hubcli", "VERSION"), "utf8").trim())

    const contents = files
      .map((file) => fs.readFileSync(path.join(extractDir, file), "utf8"))
      .join("\n")
    expect(contents).not.toMatch(/(?:sk|nvapi)-[A-Za-z0-9_-]{20,}/)
    expect(contents).not.toContain(["", "Users", "maikonviniciussilva"].join("/"))

    const brokenFixture = createWindowsPackageFixture(false)
    const failed = runDetailed("pwsh", [
      "-NoProfile",
      "-File",
      brokenFixture.packageScript,
      "-Target",
      "windows-x64",
      "-OutDir",
      "dist-release",
    ])
    expect(failed.status).not.toBe(0)
    expect(failed.stdout + failed.stderr).toContain("Version tag lookup failed with exit code")
    expect(fs.existsSync(brokenFixture.archive)).toBe(false)

    const malformedFixture = createWindowsPackageFixture(true)
    fs.appendFileSync(
      path.join(malformedFixture.root, "script", "hubcli", "release", "hubcli.ps1"),
      "\nif ($true) {\n",
    )
    const malformed = runDetailed("pwsh", [
      "-NoProfile",
      "-File",
      malformedFixture.packageScript,
      "-Target",
      "windows-x64",
      "-OutDir",
      "dist-release",
    ])
    expect(malformed.status).not.toBe(0)
    expect(malformed.stdout + malformed.stderr).toContain("generated hubcli.ps1 has parser errors")
    expect(fs.existsSync(malformedFixture.archive)).toBe(false)
  })
})

describe("package security scan", () => {
  testPosix("source scan ignores dependencies but rejects a matching source file", () => {
    const dir = tmpdir("hubcli-source-scan-")
    const dependency = path.join(dir, "node_modules", "pkg", "test.ts")
    const source = path.join(dir, "src", "real.ts")
    fs.mkdirSync(path.dirname(dependency), { recursive: true })
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.writeFileSync(dependency, "const token = 'sk-" + "n".repeat(24) + "'\n")

    const ignored = run("bash", [SECRET_SCAN, dir])
    expect(ignored.status).toBe(0)
    expect(ignored.stdout).not.toContain("node_modules")

    fs.writeFileSync(source, "const token = 'sk-" + "s".repeat(24) + "'\n")
    const rejected = run("bash", [SECRET_SCAN, dir])
    expect(rejected.status).not.toBe(0)
    expect(rejected.stdout).toContain(source)
    expect(rejected.stdout).not.toContain("node_modules")
  })

  testPosix("rejects source-control and dependency directories inside a package", () => {
    for (const forbidden of [".git", "node_modules"]) {
      const dir = tmpdir(`hubcli-package-${forbidden.replace(".", "")}-`)
      fs.mkdirSync(path.join(dir, forbidden), { recursive: true })
      const result = run("bash", [SECRET_SCAN, "--package", dir])
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain(forbidden)
    }
  })

  testPosix("rejects secret files, key literals and developer paths inside a package", () => {
    const cases: Array<[string, (dir: string) => void, string]> = [
      [
        "credentials",
        (dir) => fs.writeFileSync(path.join(dir, "credentials.env"), "NVIDIA_API_KEY=\n"),
        "credentials.env",
      ],
      ["auth", (dir) => fs.writeFileSync(path.join(dir, "auth.json"), "{}"), "auth.json"],
      [
        "key",
        (dir) => fs.writeFileSync(path.join(dir, "runtime.bin"), "sk-" + "x".repeat(24)),
        "Possible secret literal",
      ],
      [
        "path",
        (dir) =>
          fs.writeFileSync(
            path.join(dir, "runtime.bin"),
            ["", "Users", "maikonviniciussilva", "Hubcli"].join("/"),
          ),
        "Developer path",
      ],
    ]

    for (const [name, arrange, expected] of cases) {
      const dir = tmpdir(`hubcli-package-${name}-`)
      arrange(dir)
      const result = run("bash", [SECRET_SCAN, "--package", dir])
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain(expected)
    }
  })
})

describe("build.ts --target flag (static)", () => {
  test("source rejects an unrecognized --target value list format", () => {
    const buildTs = fs.readFileSync(path.join(REPO_ROOT, "packages/opencode/script/build.ts"), "utf8")
    expect(buildTs).toContain("No matching build target for --target=")
    expect(buildTs).toContain('targetFlag.split("-")[0] === "windows" ? "win32"')
  })
})

describe("shell permission probes are portable across GNU and BSD stat", () => {
  // Regression: the launchers probed permissions with
  //   stat -f "%Lp" ... || stat -c "%a" ...
  // On Linux, `stat -f` means "display FILESYSTEM status" and SUCCEEDS,
  // printing disk info instead of a mode — so the `||` fallback never ran and
  // the mode comparison saw a multi-line blob instead of "600". Every Linux
  // user with a credentials.env got "insecure permissions" and the launcher
  // refused to start. GNU `stat -c` must be tried first; on macOS/BSD it is an
  // illegal option, fails cleanly, and falls through to `stat -f`.
  const shellFiles = [
    "script/hubcli/setup.sh",
    "script/hubcli/launcher-template.sh",
    "script/hubcli/release/hubcli-dist-launcher.sh",
  ]

  for (const rel of shellFiles) {
    test(`${rel} tries GNU stat -c before BSD stat -f`, () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
      for (const line of content.split(/\r?\n/)) {
        if (!line.includes("stat -")) continue
        const gnu = line.indexOf('stat -c "%a"')
        const bsd = line.indexOf('stat -f "%Lp"')
        if (gnu === -1 && bsd === -1) continue
        expect(gnu).toBeGreaterThan(-1)
        expect(bsd).toBeGreaterThan(-1)
        expect(gnu).toBeLessThan(bsd)
      }
    })
  }

  test("the permission probe actually returns a mode on this machine", () => {
    const dir = tmpdir("hubcli-stat-probe-")
    const file = path.join(dir, "credentials.env")
    fs.writeFileSync(file, "DEEPSEEK_API_KEY=\n")
    fs.chmodSync(file, 0o600)
    const probe = `stat -c "%a" "${file}" 2>/dev/null || stat -f "%Lp" "${file}" 2>/dev/null || echo unknown`
    const { stdout } = run("bash", ["-c", probe])
    expect(stdout.trim()).toBe("600")
  })
})
