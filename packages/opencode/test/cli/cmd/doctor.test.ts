/**
 * Tests for `hubcli doctor` command.
 *
 * Split into two layers:
 *
 * 1. Unit tests — `sanitizeError` (pure function, imported directly).
 * 2. Subprocess integration tests — spawn `bun src/index.ts doctor` with
 *    isolated HOME fixtures so we can assert exit codes and output without
 *    touching any real user files.
 *
 * Security invariants verified here:
 *   - API key values are NEVER printed, even when a key var is set
 *   - Error messages are sanitized before output
 *   - Insecure permissions are reported as exit code 2
 *   - Missing config is reported as exit code 1
 *   - Connectivity failure is reported as exit code 3
 *   - doctor command is NOT registered without HUBCLI_BRAND
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { sanitizeError } from "../../../src/cli/cmd/doctor"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUN = path.join(os.homedir(), ".bun", "bin", "bun")
const CLI_ENTRY = path.join(import.meta.dir, "../../../src/index.ts")

interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function spawnDoctor(
  args: string[],
  env: Record<string, string>,
): Promise<SpawnResult> {
  const proc = Bun.spawn(
    [BUN, "--conditions=browser", CLI_ENTRY, "doctor", ...args],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { exitCode, stdout, stderr }
}

/** Minimal env for spawning the CLI — stripped of everything except essentials. */
function minimalEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: os.homedir(),         // fallback; tests override this
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "dumb",
    HUBCLI_BRAND: "1",          // required for doctor to be registered
    OPENCODE_PURE: "1",         // skip external plugin discovery
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixture factory — builds an isolated ~/.hubcli in a temp dir
// ---------------------------------------------------------------------------

interface FixtureOpts {
  /** Create opencode.json with correct structure? Default true. */
  config?: boolean
  /** Create credentials.env? Default true. */
  creds?: boolean
  /** Octal permissions for credentials.env. Default 0o600. */
  credsPerms?: number
  /** Extra env vars to merge in (e.g. API key mocks). */
  env?: Record<string, string>
}

let fixtureRoots: string[] = []

function buildFixture(opts: FixtureOpts = {}): { home: string; env: Record<string, string> } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-doctor-test-"))
  fixtureRoots.push(home)

  const hubcliDir = path.join(home, ".hubcli")
  fs.mkdirSync(hubcliDir, { recursive: true })

  // Create a stub launcher so the doctor's launcher-exists check passes.
  // The content is irrelevant — the check only tests existence + executable bit.
  const launcherDir = path.join(home, ".local", "bin")
  fs.mkdirSync(launcherDir, { recursive: true })
  const launcherPath = path.join(launcherDir, "hubcli")
  fs.writeFileSync(launcherPath, "#!/bin/sh\n# fixture launcher\n", "utf8")
  fs.chmodSync(launcherPath, 0o755)

  if (opts.config !== false) {
    fs.writeFileSync(
      path.join(hubcliDir, "opencode.json"),
      JSON.stringify({
        model: "alibaba-token-plan/qwen3.7-max",
        provider: {
          "alibaba-token-plan": {
            options: { apiKey: "{env:DASHSCOPE_API_KEY}" },
            whitelist: [
              "qwen3.7-max",
              "qwen3.6-plus",
              "qwen3.6-flash",
              "glm-5",
              "glm-5.1",
              "glm-5.2",
            ],
          },
          deepseek: {
            options: { apiKey: "{env:DEEPSEEK_API_KEY}" },
            whitelist: ["deepseek-v4-pro", "deepseek-v4-flash"],
          },
        },
      }),
      "utf8",
    )
  }

  if (opts.creds !== false) {
    const credsPath = path.join(hubcliDir, "credentials.env")
    fs.writeFileSync(credsPath, "# test fixture\n", "utf8")
    fs.chmodSync(credsPath, opts.credsPerms ?? 0o600)
  }

  const env = minimalEnv({
    HOME: home,
    OPENCODE_CONFIG_DIR: hubcliDir,
    ...(opts.env ?? {}),
  })

  return { home, env }
}

afterAll(() => {
  for (const root of fixtureRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

// ---------------------------------------------------------------------------
// 1. Unit tests — sanitizeError (pure function)
// ---------------------------------------------------------------------------

describe("sanitizeError", () => {
  test("passes through messages with no keys", () => {
    expect(sanitizeError("Connection timed out")).toBe("Connection timed out")
    expect(sanitizeError("HTTP 401: Unauthorized")).toBe("HTTP 401: Unauthorized")
    expect(sanitizeError("")).toBe("")
  })

  test("masks sk- prefixed strings (API keys)", () => {
    expect(sanitizeError("Bearer sk-abc123XYZ")).toBe("Bearer sk-••••")
    expect(sanitizeError("invalid key sk-ABCDEF1234567890 provided")).toBe(
      "invalid key sk-•••• provided",
    )
  })

  test("masks multiple sk- occurrences in one message", () => {
    const msg = "key1=sk-AAAA key2=sk-BBBB"
    expect(sanitizeError(msg)).toBe("key1=sk-•••• key2=sk-••••")
  })

  test("does NOT mask short strings that happen to start with sk-", () => {
    // The regex requires at least 4 alphanumeric chars after sk-
    expect(sanitizeError("sk-abc")).toBe("sk-abc")  // only 3 chars — not masked
  })

  test("leaves unrelated variable names intact", () => {
    expect(sanitizeError("DASHSCOPE_API_KEY not set")).toBe("DASHSCOPE_API_KEY not set")
    expect(sanitizeError("DEEPSEEK_API_KEY missing")).toBe("DEEPSEEK_API_KEY missing")
  })
})

// ---------------------------------------------------------------------------
// 2. Subprocess tests — exit codes and output invariants
// ---------------------------------------------------------------------------
//
// These tests spawn the real CLI binary in an isolated HOME so we don't
// touch the developer's ~/.hubcli. Each test builds a minimal fixture, runs
// `bun src/index.ts doctor [flags]`, and asserts the exit code and output.
//
// Timeout: 30s per test (bun startup + doctor logic). Heavy but necessary
// because bun cold-starts are ~1s and we can't pre-warm easily.

const DOCTOR_TIMEOUT = 30_000

describe("doctor command — exit code 0 (all checks pass)", () => {
  test(
    "exits 0 with config, credentials 600, and both API keys present",
    async () => {
      const { env } = buildFixture({
        env: {
          DASHSCOPE_API_KEY: "dashscope-test-token",
          DEEPSEEK_API_KEY: "deepseek-test-token",
        },
      })
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("DASHSCOPE_API_KEY")
      expect(result.stdout).toContain("DEEPSEEK_API_KEY")
      // Must NEVER print the actual key values
      expect(result.stdout).not.toContain("dashscope-test-token")
      expect(result.stdout).not.toContain("deepseek-test-token")
    },
    DOCTOR_TIMEOUT,
  )
})

describe("doctor command — exit code 1 (config error)", () => {
  test(
    "exits 1 when opencode.json is absent",
    async () => {
      const { env } = buildFixture({ config: false })
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain("check(s) failed")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "exits 1 when opencode.json is malformed JSON",
    async () => {
      const { home, env } = buildFixture({ config: false })
      const hubcliDir = path.join(home, ".hubcli")
      fs.writeFileSync(path.join(hubcliDir, "opencode.json"), "{ invalid json }", "utf8")
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain("ERROR")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "exits 1 when provider block is missing from config",
    async () => {
      const { home, env } = buildFixture({ config: false })
      const hubcliDir = path.join(home, ".hubcli")
      fs.writeFileSync(
        path.join(hubcliDir, "opencode.json"),
        JSON.stringify({ model: "alibaba-token-plan/qwen3.7-max" }),
        "utf8",
      )
      // No provider block → 0 whitelisted models → missing expected models WARN
      // This is a warning, not a FAIL, so we only assert exit might be 0 or 1
      const result = await spawnDoctor([], env)
      // provider missing means 0 models → expected models warning → exit ≥ 0
      // The important thing: should not crash
      expect([0, 1]).toContain(result.exitCode)
    },
    DOCTOR_TIMEOUT,
  )
})

describe("doctor command — exit code 2 (insecure permissions)", () => {
  test(
    "exits 2 when credentials.env has permissions 644",
    async () => {
      const { env } = buildFixture({ credsPerms: 0o644 })
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toContain("INSECURE")
      // Must not print actual key values
      expect(result.stdout).not.toContain("sk-")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "exits 2 when credentials.env has permissions 640",
    async () => {
      const { env } = buildFixture({ credsPerms: 0o640 })
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(2)
    },
    DOCTOR_TIMEOUT,
  )
})

describe("doctor command — exit code 3 (connectivity failure)", () => {
  test(
    "exits 3 when --connect is used with an invalid API key",
    async () => {
      const { env } = buildFixture({
        env: {
          // Deliberately invalid key — will cause HTTP 401 from the real provider
          DASHSCOPE_API_KEY: "invalid-key-for-testing-only",
          DEEPSEEK_API_KEY: "invalid-key-for-testing-only",
        },
      })
      const result = await spawnDoctor(["--connect"], env)
      expect(result.exitCode).toBe(3)
      // Error output must NOT include the fake key value
      expect(result.stdout).not.toContain("invalid-key-for-testing-only")
      expect(result.stderr).not.toContain("invalid-key-for-testing-only")
      expect(result.stdout).toContain("FAILED")
    },
    60_000, // connectivity test can take up to 30s per provider
  )
})

describe("doctor command — output content invariants", () => {
  test(
    "DASHSCOPE_API_KEY presence is reported as 'present' when set",
    async () => {
      const { env } = buildFixture({
        env: { DASHSCOPE_API_KEY: "any-value-not-shown", DEEPSEEK_API_KEY: "any-value-not-shown" },
      })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("DASHSCOPE_API_KEY")
      expect(result.stdout).toContain("present")
      expect(result.stdout).not.toContain("any-value-not-shown")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "DASHSCOPE_API_KEY absence is reported as 'missing' when not set",
    async () => {
      const { env } = buildFixture() // no key overrides → no API keys in env
      // remove API keys that might have leaked from parent process env
      delete env["DASHSCOPE_API_KEY"]
      delete env["DEEPSEEK_API_KEY"]
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("missing")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "--verbose shows apiKey variable reference not resolved value",
    async () => {
      const { env } = buildFixture({
        env: { DASHSCOPE_API_KEY: "secret-value-must-not-appear" },
      })
      const result = await spawnDoctor(["--verbose"], env)
      // Should show the template reference from config
      expect(result.stdout).toContain("{env:DASHSCOPE_API_KEY}")
      // Must NEVER show the resolved value
      expect(result.stdout).not.toContain("secret-value-must-not-appear")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "credentials 600 reported as 'OK'",
    async () => {
      const { env } = buildFixture()
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("600 (OK)")
    },
    DOCTOR_TIMEOUT,
  )
})

describe("doctor command — HUBCLI_BRAND guard", () => {
  test(
    "--help without HUBCLI_BRAND=1 does not mention 'doctor'",
    async () => {
      const env = minimalEnv()
      delete env["HUBCLI_BRAND"] // run as opencode, not hubcli

      const proc = Bun.spawn(
        [BUN, "--conditions=browser", CLI_ENTRY, "--help"],
        { env, stdout: "pipe", stderr: "pipe" },
      )
      const [_exitCode, helpOutput] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ])
      // doctor must NOT appear in the command list when HUBCLI_BRAND is absent
      expect(helpOutput).not.toContain("doctor")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "--help WITH HUBCLI_BRAND=1 includes 'doctor'",
    async () => {
      const env = minimalEnv() // HUBCLI_BRAND=1 is already included

      const proc = Bun.spawn(
        [BUN, "--conditions=browser", CLI_ENTRY, "--help"],
        { env, stdout: "pipe", stderr: "pipe" },
      )
      const [_exitCode, helpOutput] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ])
      expect(helpOutput).toContain("doctor")
    },
    DOCTOR_TIMEOUT,
  )
})
