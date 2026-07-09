/**
 * Tests for the release packaging + install.sh logic that don't require an
 * actual cross-compiled binary (those are exercised manually — see
 * CHANGELOG-HUBCLI.md for the real build/package/install run performed this
 * session). These check: generate-checksums.sh format, install.sh's
 * checksum-mismatch abort path, and install.sh --check/--uninstall against a
 * synthetic (non-binary) package, all in temp dirs, no network, no real keys.
 */

import { describe, test, expect, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../..")
const INSTALL_SH = path.join(REPO_ROOT, "install.sh")
const GENERATE_CHECKSUMS = path.join(REPO_ROOT, "script/hubcli/release/generate-checksums.sh")

let tmpDirs: string[] = []
function tmpdir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {}
  }
})

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", env })
    return { stdout, status: 0 }
  } catch (e: any) {
    return { stdout: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""), status: e.status ?? 1 }
  }
}

function sha256(filePath: string): string {
  return execFileSync("shasum", ["-a", "256", filePath], { encoding: "utf8" }).split(/\s+/)[0]
}

// Builds a fake "hubcli-<target>.tar.gz" package (a real gzip tarball, but
// with a tiny placeholder script instead of the real compiled binaries) so
// install.sh's download/checksum/extract/smoke-test pipeline can be
// exercised without a multi-minute cross-compile in the test suite.
function buildFakePackage(dir: string, target: string): string {
  const pkgName = `hubcli-${target}`
  const stage = path.join(dir, pkgName)
  fs.mkdirSync(stage, { recursive: true })
  const launcher = `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "hubcli-vTEST"; exit 0; fi\necho "fake hubcli-runtime"\n`
  fs.writeFileSync(path.join(stage, "hubcli"), launcher)
  fs.writeFileSync(path.join(stage, "hubcli-runtime"), launcher)
  fs.writeFileSync(path.join(stage, "hubcli-fast"), launcher)
  fs.writeFileSync(path.join(stage, "LICENSE"), "MIT")
  fs.writeFileSync(path.join(stage, "README.txt"), "fake package for tests")
  for (const f of ["hubcli", "hubcli-runtime", "hubcli-fast"]) fs.chmodSync(path.join(stage, f), 0o755)
  execFileSync("tar", ["-C", dir, "-czf", path.join(dir, `${pkgName}.tar.gz`), pkgName])
  return path.join(dir, `${pkgName}.tar.gz`)
}

describe("generate-checksums.sh", () => {
  test("writes sha256 + filename pairs matching shasum for every archive/installer", () => {
    const dir = tmpdir("hubcli-checksums-")
    fs.writeFileSync(path.join(dir, "hubcli-darwin-x64.tar.gz"), "fake archive contents")
    fs.writeFileSync(path.join(dir, "install.sh"), "fake installer")
    const { status } = run("bash", [GENERATE_CHECKSUMS, dir])
    expect(status).toBe(0)
    const checksums = fs.readFileSync(path.join(dir, "checksums-sha256.txt"), "utf8")
    expect(checksums).toContain(`${sha256(path.join(dir, "hubcli-darwin-x64.tar.gz"))}  hubcli-darwin-x64.tar.gz`)
    expect(checksums).toContain(`${sha256(path.join(dir, "install.sh"))}  install.sh`)
  })
})

describe("install.sh (local source, no network)", () => {
  const target = `${process.platform === "darwin" ? "darwin" : "linux"}-x64`

  test("valid checksum: installs, smoke test passes, binaries present", () => {
    const sourceDir = tmpdir("hubcli-install-src-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])

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

  test("checksum mismatch: aborts, installs nothing", () => {
    const sourceDir = tmpdir("hubcli-install-badsrc-")
    buildFakePackage(sourceDir, target)
    fs.writeFileSync(
      path.join(sourceDir, "checksums-sha256.txt"),
      `0000000000000000000000000000000000000000000000000000000000000000  hubcli-${target}.tar.gz\n`,
    )

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

  test("--repair preserves existing credentials.env content", () => {
    const sourceDir = tmpdir("hubcli-install-repairsrc-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])

    const fakeHome = tmpdir("hubcli-install-repairhome-")
    const binDir = path.join(fakeHome, "bin")
    const env = { ...process.env, HOME: fakeHome, HUBCLI_BIN_DIR: binDir, HUBCLI_INSTALL_SOURCE: sourceDir }
    run("bash", [INSTALL_SH, "--version", "hubcli-vTEST"], env)

    const credsPath = path.join(fakeHome, ".hubcli", "credentials.env")
    fs.appendFileSync(credsPath, "DEEPSEEK_API_KEY=user-added-value\n")

    const { status } = run("bash", [INSTALL_SH, "--repair", "--version", "hubcli-vTEST"], env)
    expect(status).toBe(0)
    expect(fs.readFileSync(credsPath, "utf8")).toContain("user-added-value")
    expect(fs.readdirSync(binDir).some((f) => f.startsWith(".hubcli-backup-"))).toBe(true)
  })

  test("--uninstall removes binaries but never touches ~/.hubcli", () => {
    const sourceDir = tmpdir("hubcli-install-uninstallsrc-")
    buildFakePackage(sourceDir, target)
    run("bash", [GENERATE_CHECKSUMS, sourceDir])

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

  test("never accepts an API key as a command-line argument (no such flag exists)", () => {
    const content = fs.readFileSync(INSTALL_SH, "utf8")
    expect(content).not.toMatch(/--(api-key|token|deepseek-key|nvidia-key)/i)
  })
})

describe("build.ts --target flag (static checks, no real cross-compile in this test)", () => {
  test("build.ts source rejects an unrecognized --target value list format", () => {
    const buildTs = fs.readFileSync(path.join(REPO_ROOT, "packages/opencode/script/build.ts"), "utf8")
    expect(buildTs).toContain("No matching build target for --target=")
    expect(buildTs).toContain('targetFlag.split("-")[0] === "windows" ? "win32"')
  })
})
