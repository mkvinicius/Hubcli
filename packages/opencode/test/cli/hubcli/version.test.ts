/**
 * Tests for the HubCli version resolution pipeline: script/hubcli/resolve-version.sh
 * (single source of truth), the launcher template placeholder substitution, and the
 * fast.ts fallback. No real credentials, no network, all work happens in temp dirs.
 */

import { describe, test, expect, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../..")
const RESOLVE_SCRIPT = path.join(REPO_ROOT, "script/hubcli/resolve-version.sh")
const LAUNCHER_TEMPLATE = path.join(REPO_ROOT, "script/hubcli/launcher-template.sh")
const VERSION_FILE = path.join(REPO_ROOT, "script/hubcli/VERSION")
const FAST_ENTRY = path.join(REPO_ROOT, "packages/opencode/src/cli/hubcli/fast.ts")

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

function run(cmd: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", env })
    return { stdout, status: 0 }
  } catch (e: any) {
    return { stdout: e.stdout?.toString() ?? "", status: e.status ?? 1 }
  }
}

describe("resolve-version.sh", () => {
  test("no tag, no VERSION file -> local", () => {
    const dir = tmpdir("hubcli-version-none-")
    fs.mkdirSync(path.join(dir, "script/hubcli"), { recursive: true })
    fs.copyFileSync(RESOLVE_SCRIPT, path.join(dir, "script/hubcli/resolve-version.sh"))
    run("git", ["init", "-q"], dir)
    run("git", ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"], dir)
    const { stdout, status } = run("bash", [path.join(dir, "script/hubcli/resolve-version.sh")])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe("local")
  })

  test("VERSION file present, no tag -> file content wins over local fallback", () => {
    const dir = tmpdir("hubcli-version-file-")
    fs.mkdirSync(path.join(dir, "script/hubcli"), { recursive: true })
    fs.copyFileSync(RESOLVE_SCRIPT, path.join(dir, "script/hubcli/resolve-version.sh"))
    fs.writeFileSync(path.join(dir, "script/hubcli/VERSION"), "hubcli-v0.1.0-rc.9\n")
    run("git", ["init", "-q"], dir)
    run("git", ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"], dir)
    const { stdout, status } = run("bash", [path.join(dir, "script/hubcli/resolve-version.sh")])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe("hubcli-v0.1.0-rc.9")
  })

  test("exact git tag at HEAD wins over VERSION file", () => {
    const dir = tmpdir("hubcli-version-tag-")
    fs.mkdirSync(path.join(dir, "script/hubcli"), { recursive: true })
    fs.copyFileSync(RESOLVE_SCRIPT, path.join(dir, "script/hubcli/resolve-version.sh"))
    fs.writeFileSync(path.join(dir, "script/hubcli/VERSION"), "hubcli-v0.1.0-rc.9\n")
    run("git", ["init", "-q"], dir)
    run("git", ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"], dir)
    run("git", ["tag", "hubcli-v0.1.0-rc.10"], dir)
    const { stdout, status } = run("bash", [path.join(dir, "script/hubcli/resolve-version.sh")])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe("hubcli-v0.1.0-rc.10")
  })

  test("repo VERSION file matches the actual resolved version (no drift)", () => {
    expect(fs.existsSync(VERSION_FILE)).toBe(true)
    const fileVersion = fs.readFileSync(VERSION_FILE, "utf8").trim()
    expect(fileVersion).toMatch(/^hubcli-v\d+\.\d+\.\d+-rc\.\d+$/)
    const { stdout, status } = run("bash", [RESOLVE_SCRIPT])
    expect(status).toBe(0)
    // In this repo there is no hubcli-v* tag at HEAD yet, so the resolver
    // must fall back to the VERSION file rather than inventing a version.
    expect(stdout.trim()).toBe(fileVersion)
  })
})

describe("launcher template placeholder substitution", () => {
  test("template has no leftover hardcoded rc.N version, only the placeholder", () => {
    const content = fs.readFileSync(LAUNCHER_TEMPLATE, "utf8")
    expect(content).toContain('HUBCLI_VERSION="__HUBCLI_VERSION__"')
    expect(content).not.toMatch(/HUBCLI_VERSION="hubcli-v[\d.]+-rc\.\d+"/)
  })

  test("sed substitution produces a launcher that prints the resolved version", () => {
    const dir = tmpdir("hubcli-launcher-")
    const fakeSrc = path.join(dir, "src")
    fs.mkdirSync(fakeSrc, { recursive: true })
    const template = fs.readFileSync(LAUNCHER_TEMPLATE, "utf8")
    const substituted = template.replaceAll("__HUBCLI_SRC__", fakeSrc).replaceAll("__HUBCLI_VERSION__", "hubcli-v0.1.0-rc.4")
    const launcherPath = path.join(dir, "hubcli")
    fs.writeFileSync(launcherPath, substituted)
    fs.chmodSync(launcherPath, 0o755)
    const { stdout, status } = run(launcherPath, ["--version"])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe("hubcli-v0.1.0-rc.4")
  })

  test("HUBCLI_DEV=1 skips the installed-version fast path (falls through to source mode)", () => {
    const dir = tmpdir("hubcli-launcher-dev-")
    const template = fs.readFileSync(LAUNCHER_TEMPLATE, "utf8")
    // Point HUBCLI_SRC at a directory that exists but has no real opencode
    // entrypoint — this forces the "source not found" exit once execution
    // falls through past the (skipped) --version fast path, which is enough
    // to prove HUBCLI_DEV=1 bypassed the instant-print short-circuit (a real
    // fast path would have printed the version and exited 0 first).
    const fakeSrc = path.join(dir, "src")
    fs.mkdirSync(fakeSrc, { recursive: true })
    const substituted = template.replaceAll("__HUBCLI_SRC__", fakeSrc).replaceAll("__HUBCLI_VERSION__", "hubcli-v0.1.0-rc.4")
    const launcherPath = path.join(dir, "hubcli")
    fs.writeFileSync(launcherPath, substituted)
    fs.chmodSync(launcherPath, 0o755)
    const { stdout, status } = run(launcherPath, ["--version"], undefined, { ...process.env, HUBCLI_DEV: "1" })
    // Not the installed version, and not an early success exit.
    expect(stdout.trim()).not.toBe("hubcli-v0.1.0-rc.4")
    expect(status).not.toBe(0)
  })
})

describe("fast.ts VERSION fallback", () => {
  test("HUBCLI_VERSION env var is honored when set (as the launcher always does)", () => {
    const out = execFileSync("bun", ["run", "--conditions=browser", FAST_ENTRY, "--version"], {
      encoding: "utf8",
      env: { ...process.env, HUBCLI_VERSION: "hubcli-v0.1.0-rc.4", HOME: tmpdir("hubcli-fast-home-") },
    })
    expect(out.trim()).toBe("hubcli-v0.1.0-rc.4")
  })

  test("falls back to 'local' when invoked directly without HUBCLI_VERSION (dev bypass)", () => {
    const env = { ...process.env }
    delete env.HUBCLI_VERSION
    const out = execFileSync("bun", ["run", "--conditions=browser", FAST_ENTRY, "--version"], {
      encoding: "utf8",
      env: { ...env, HOME: tmpdir("hubcli-fast-home2-") },
    })
    expect(out.trim()).toBe("local")
  })
})
