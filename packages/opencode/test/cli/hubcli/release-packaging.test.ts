/**
 * Release packaging and installer tests. POSIX installer execution is scoped
 * to macOS/Linux; checksum parsing and installer security checks are portable.
 */

import { describe, test, expect, afterAll } from "bun:test"
import { execFileSync } from "child_process"
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

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
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
    expect(content).toContain("Get-FileHash")
    expect(content).toContain("[switch]$Repair")
    expect(content).toContain("[switch]$Uninstall")
    expect(content).not.toMatch(/^\s*(Invoke-Expression|iex)\b/im)
    expect(content).not.toMatch(/\[(string|securestring)\]\$(ApiKey|Token|DeepseekKey|NvidiaKey)\b/i)
  })

  testWindows("-Help succeeds without network or credentials", () => {
    const { stdout, status } = run("pwsh", ["-NoProfile", "-File", INSTALL_PS1, "-Help"])
    expect(status).toBe(0)
    expect(stdout).toMatch(/HubCli|install/i)
  })

  test("Windows build and package scripts use native executables and zip packaging", () => {
    const build = fs.readFileSync(BUILD_WINDOWS, "utf8")
    const packaging = fs.readFileSync(PACKAGE_WINDOWS, "utf8")
    expect(build).toContain('[ValidateSet("windows-x64")]')
    expect(build).toContain("--target=bun-windows-x64")
    expect(packaging).toContain("Compress-Archive")
    expect(packaging).toContain("hubcli.cmd")
    expect(packaging).toContain("hubcli.ps1")
  })
})

describe("package security scan", () => {
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
