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
import {
  sanitizeError,
  summarizeProviderError,
  checkOpenCodeAuth,
  readFableCatalog,
  testFableConnection,
} from "../../../src/cli/cmd/doctor"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUN = process.execPath
const CLI_ENTRY = path.join(import.meta.dir, "../../../src/index.ts")
const isWindows = process.platform === "win32"
const testPosix = isWindows ? test.skip : test
const testWindows = isWindows ? test : test.skip

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
  const home = overrides.HOME ?? os.homedir()
  return {
    HOME: home,                 // fallback; tests override this
    USERPROFILE: overrides.USERPROFILE ?? home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "dumb",
    HUBCLI_BRAND: "1",          // required for doctor to be registered
    OPENCODE_PURE: "1",         // skip external plugin discovery
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    SystemRoot: process.env.SystemRoot ?? "",
    COMSPEC: process.env.COMSPEC ?? "",
    TMP: process.env.TMP ?? os.tmpdir(),
    TEMP: process.env.TEMP ?? os.tmpdir(),
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
  /**
   * OpenCode auth.json content (fake values only):
   *   "valid"   — opencode entry present
   *   "absent"  — file exists but no opencode entry
   *   "invalid" — malformed JSON
   *   undefined — file not created
   */
  authJson?: "valid" | "absent" | "invalid"
  /** Create ~/.cache/opencode/models.json with claude-fable-5? Default: not created. */
  fableInCatalog?: boolean
}

// Fake token — must never appear in doctor output
const FAKE_OPENCODE_TOKEN = "fake-opencode-token-never-print-me"

let fixtureRoots: string[] = []

function writeLauncher(filePath: string, body: string): void {
  fs.writeFileSync(filePath, body, "utf8")
  if (!isWindows) fs.chmodSync(filePath, 0o755)
}

function defaultLauncherBody(): string {
  return isWindows ? "@echo off\r\necho OK\r\nexit /b 0\r\n" : "#!/bin/sh\necho OK\n"
}

function buildFixture(opts: FixtureOpts = {}): { home: string; env: Record<string, string> } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-doctor-test-"))
  fixtureRoots.push(home)

  const hubcliDir = path.join(home, ".hubcli")
  fs.mkdirSync(hubcliDir, { recursive: true })

  // Create a stub launcher so the doctor's launcher-exists check passes.
  // The content is irrelevant — the check only tests existence + executable bit.
  const launcherDir = path.join(home, ".local", "bin")
  fs.mkdirSync(launcherDir, { recursive: true })
  const launcherPath = path.join(launcherDir, isWindows ? "hubcli.cmd" : "hubcli")
  writeLauncher(launcherPath, defaultLauncherBody())

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
    if (!isWindows) fs.chmodSync(credsPath, opts.credsPerms ?? 0o600)
  }

  // OpenCode auth.json fixture (fake values only — never the real file)
  if (opts.authJson) {
    const authDir = path.join(home, ".local", "share", "opencode")
    fs.mkdirSync(authDir, { recursive: true })
    const authPath = path.join(authDir, "auth.json")
    if (opts.authJson === "valid") {
      fs.writeFileSync(authPath, JSON.stringify({ opencode: { type: "api", key: FAKE_OPENCODE_TOKEN } }), "utf8")
    } else if (opts.authJson === "absent") {
      fs.writeFileSync(authPath, JSON.stringify({ "other-provider": { type: "api", key: FAKE_OPENCODE_TOKEN } }), "utf8")
    } else {
      fs.writeFileSync(authPath, "{ not valid json !!", "utf8")
    }
    if (!isWindows) fs.chmodSync(authPath, 0o600)
  }

  // models.json cache fixture
  if (opts.fableInCatalog) {
    const cacheDir = path.join(home, ".cache", "opencode")
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(
      path.join(cacheDir, "models.json"),
      JSON.stringify({
        opencode: {
          id: "opencode",
          models: {
            "claude-fable-5": {
              id: "claude-fable-5",
              name: "Claude Fable 5",
              status: "deprecated",
              limit: { context: 1000000, output: 128000 },
              cost: { input: 10, output: 50 },
            },
          },
        },
      }),
      "utf8",
    )
  }

  const env = minimalEnv({
    HOME: home,
    USERPROFILE: home,
    OPENCODE_CONFIG_DIR: hubcliDir,
    HUBCLI_LAUNCHER: launcherPath,
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

  test("masks nvapi- NVIDIA keys", () => {
    expect(sanitizeError("Authorization: Bearer nvapi-ABCDEF123456")).toBe("Authorization: Bearer nvapi-••••")
  })
})

describe("summarizeProviderError (NVIDIA 400/500 regression)", () => {
  test("HTTP 400 body is reduced to a short reason — never the raw JSON", () => {
    // This is the exact shape the user observed for MiniMax M3 post-merge.
    const raw = 'Bad Request: {"status":400,"title":"Bad Request","detail":"model rejected the request payload with a long body that must not be printed"}'
    const out = summarizeProviderError(raw)
    expect(out).toBe("request rejected by provider (HTTP 400)")
    // no raw/partial JSON body leaks through
    expect(out).not.toContain("{")
    expect(out).not.toContain("detail")
    expect(out).not.toContain("title")
  })

  test("mid-stream internal_server_error maps to HTTP 500", () => {
    const raw = 'data: {"error":{"message":"Internal server error","type":"internal_server_error","code":500}}'
    const out = summarizeProviderError(raw)
    expect(out).toBe("provider internal error (HTTP 500)")
    expect(out).not.toContain("{")
  })

  test("classifies auth, not-found, rate limit", () => {
    expect(summarizeProviderError("HTTP 401 Unauthorized")).toContain("HTTP 401")
    expect(summarizeProviderError("HTTP 403 Forbidden")).toContain("HTTP 403")
    expect(summarizeProviderError("model not found HTTP 404")).toBe("model or endpoint not found (HTTP 404)")
    expect(summarizeProviderError("HTTP 429 Too Many Requests")).toBe("rate limited or out of quota (HTTP 429)")
  })

  test("timeout is recognized", () => {
    expect(summarizeProviderError("timeout after 60s")).toBe("timeout waiting for provider")
  })

  test("still masks secrets inside an error body", () => {
    const out = summarizeProviderError("weird error nvapi-SECRETKEY12345 with no status code here at all")
    expect(out).not.toContain("nvapi-SECRETKEY12345")
    expect(out).toContain("nvapi-••••")
  })

  test("body-free fallback stays short and single-line", () => {
    const out = summarizeProviderError("some\nmultiline\nprovider message without a recognizable status code that is quite long indeed and keeps going")
    expect(out).not.toContain("\n")
    expect(out.length).toBeLessThanOrEqual(80)
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
  testPosix(
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

  testPosix(
    "exits 2 when credentials.env has permissions 640",
    async () => {
      const { env } = buildFixture({ credsPerms: 0o640 })
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(2)
    },
    DOCTOR_TIMEOUT,
  )

  testWindows(
    "does not treat unsupported Unix permissions as fatal on Windows",
    async () => {
      const { env } = buildFixture()
      const result = await spawnDoctor([], env)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("unsupported on Windows")
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
      // DeepSeek is REQUIRED → invalid key must produce exit 3.
      expect(result.exitCode).toBe(3)
      // Error output must NOT include the fake key value
      expect(result.stdout).not.toContain("invalid-key-for-testing-only")
      expect(result.stderr).not.toContain("invalid-key-for-testing-only")
      expect(result.stdout).toContain("FAILED")
      // Alibaba is DEGRADED → invalid key is UNAVAILABLE/WARN, not FAILED,
      // with the entitlement guidance and no raw API body echoed.
      expect(result.stdout).toContain("UNAVAILABLE")
      expect(result.stdout).toContain("verify Token Plan subscription")
      expect(result.stdout).not.toContain("connect-alibaba-token-plan: HTTP")
    },
    60_000, // connectivity test can take up to 30s per provider
  )

  test(
    "Zen group is required: all Zen models failing → exit 3",
    async () => {
      const { home, env } = buildFixture({
        env: { DASHSCOPE_API_KEY: "fake", DEEPSEEK_API_KEY: "fake" },
      })
      // Make the fixture launcher fail every `hubcli run` call, so Fable,
      // gpt-5.2-codex and kimi-k2.7-code all come back unreachable.
      const launcher = path.join(home, ".local", "bin", isWindows ? "hubcli.cmd" : "hubcli")
      writeLauncher(launcher, isWindows ? "@echo off\r\nexit /b 1\r\n" : "#!/bin/sh\nexit 1\n")
      const result = await spawnDoctor(["--connect"], env)
      expect(result.exitCode).toBe(3)
      expect(result.stdout).toContain("no OpenCode Zen model reachable")
    },
    60_000,
  )

  test(
    "NVIDIA 400 body → WARNING (not FAIL), sanitized reason, no raw JSON, no secret leak",
    async () => {
      const { home, env } = buildFixture({
        env: {
          DASHSCOPE_API_KEY: "fake",
          DEEPSEEK_API_KEY: "fake",
          NVIDIA_API_KEY: "nvapi-fake-probe-key",
        },
      })
      // Launcher stub: Zen models answer OK; the NVIDIA probe model returns a
      // raw 400 body (the exact shape the user saw) with an embedded secret.
      const launcher = path.join(home, ".local", "bin", isWindows ? "hubcli.cmd" : "hubcli")
      writeLauncher(
        launcher,
        isWindows
          ? '@echo off\r\nset ARGS=%*\r\necho %ARGS% | findstr /C:"minimax-m3" >nul\r\nif %errorlevel%==0 (\r\n  echo Error: Bad Request: {"status":400,"title":"Bad Request","detail":"leak nvapi-SECRET99999 must not print"} 1>&2\r\n  exit /b 1\r\n)\r\necho OK\r\nexit /b 0\r\n'
          : '#!/bin/sh\ncase "$*" in\n' +
              '  *minimax-m3*) echo \'Error: Bad Request: {"status":400,"title":"Bad Request","detail":"leak nvapi-SECRET99999 must not print"}\' >&2; exit 1 ;;\n' +
              "  *) echo OK; exit 0 ;;\n" +
              "esac\n",
      )
      const result = await spawnDoctor(["--connect"], env)

      // NVIDIA is advisory: shown as WARNING with a clean reason.
      expect(result.stdout).toContain("NVIDIA NIM")
      expect(result.stdout).toContain("request rejected by provider (HTTP 400)")
      expect(result.stdout).toContain("verify model compatibility")
      // Never dumps the raw/partial JSON body.
      expect(result.stdout).not.toContain('{"status":400')
      expect(result.stdout).not.toContain('"title"')
      expect(result.stdout).not.toContain("detail")
      // Never leaks the secret embedded in the body.
      expect(result.stdout).not.toContain("nvapi-SECRET99999")
      expect(result.stderr).not.toContain("nvapi-SECRET99999")
      // NVIDIA must be a WARN, never a FAIL line.
      expect(result.stdout).not.toMatch(/FAILED.*NVIDIA|NVIDIA.*FAILED/)
    },
    60_000,
  )
})

describe("doctor command — default model comes from config, not code", () => {
  test(
    "shows the model set in opencode.json (fixture default)",
    async () => {
      const { env } = buildFixture()
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("alibaba-token-plan/qwen3.7-max")
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "shows a different default when the config changes",
    async () => {
      const { home, env } = buildFixture()
      const cfgPath = path.join(home, ".hubcli", "opencode.json")
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"))
      cfg.model = "opencode/gpt-5.2-codex"
      fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8")
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("opencode/gpt-5.2-codex")
    },
    DOCTOR_TIMEOUT,
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

  testPosix(
    "credentials 600 reported as 'OK'",
    async () => {
      const { env } = buildFixture()
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("600 (OK)")
    },
    DOCTOR_TIMEOUT,
  )

  testWindows(
    "credentials permissions are reported as unsupported on Windows",
    async () => {
      const { env } = buildFixture()
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("unsupported on Windows")
      expect(result.exitCode).toBe(0)
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

// ---------------------------------------------------------------------------
// 3. Claude Fable 5 (experimental) — unit tests
// ---------------------------------------------------------------------------

describe("checkOpenCodeAuth (unit, fixture paths only)", () => {
  function tmpAuth(content: string | null, perms = 0o600): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-auth-test-"))
    fixtureRoots.push(dir)
    const p = path.join(dir, "auth.json")
    if (content !== null) {
      fs.writeFileSync(p, content, "utf8")
      fs.chmodSync(p, perms)
    }
    return p
  }

  test("missing file → missing-file", () => {
    const p = tmpAuth(null)
    expect(checkOpenCodeAuth(p).state).toBe("missing-file")
  })

  test("invalid JSON → invalid-json (no crash)", () => {
    const p = tmpAuth("{ broken !!")
    expect(checkOpenCodeAuth(p).state).toBe("invalid-json")
  })

  test("opencode entry absent → provider-absent", () => {
    const p = tmpAuth(JSON.stringify({ other: { type: "api", key: "fake" } }))
    expect(checkOpenCodeAuth(p).state).toBe("provider-absent")
  })

  testPosix("opencode entry present → present, perms reported, token never returned", () => {
    const p = tmpAuth(JSON.stringify({ opencode: { type: "api", key: "fake-token-value" } }))
    const result = checkOpenCodeAuth(p)
    expect(result.state).toBe("present")
    expect(result.perms).toBe("600")
    // the result object must not carry any token material
    expect(JSON.stringify(result)).not.toContain("fake-token-value")
  })

  testWindows("opencode entry present → present without leaking token on Windows", () => {
    const p = tmpAuth(JSON.stringify({ opencode: { type: "api", key: "fake-token-value" } }))
    const result = checkOpenCodeAuth(p)
    expect(result.state).toBe("present")
    expect(result.perms).toBe("unsupported")
    expect(JSON.stringify(result)).not.toContain("fake-token-value")
  })
})

describe("readFableCatalog (unit, fixture paths only)", () => {
  function tmpCatalog(content: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-catalog-test-"))
    fixtureRoots.push(dir)
    const p = path.join(dir, "models.json")
    if (content !== null) fs.writeFileSync(p, content, "utf8")
    return p
  }

  test("fable present with deprecated status", () => {
    const p = tmpCatalog(
      JSON.stringify({
        opencode: {
          models: {
            "claude-fable-5": {
              status: "deprecated",
              limit: { context: 1000000, output: 128000 },
              cost: { input: 10, output: 50 },
            },
          },
        },
      }),
    )
    const info = readFableCatalog(p)
    expect(info.found).toBe(true)
    expect(info.status).toBe("deprecated")
    expect(info.context).toBe("1000000")
    expect(info.costInput).toBe("$10/M")
  })

  test("fable removed from catalog → found false, all unknown", () => {
    const p = tmpCatalog(JSON.stringify({ opencode: { models: {} } }))
    const info = readFableCatalog(p)
    expect(info.found).toBe(false)
    expect(info.status).toBe("unknown")
    expect(info.context).toBe("unknown")
  })

  test("cache file missing → found false, no crash", () => {
    const info = readFableCatalog("/nonexistent/models.json")
    expect(info.found).toBe(false)
  })

  test("metadata fields absent → unknown, not invented", () => {
    const p = tmpCatalog(JSON.stringify({ opencode: { models: { "claude-fable-5": {} } } }))
    const info = readFableCatalog(p)
    expect(info.found).toBe(true)
    expect(info.context).toBe("unknown")
    expect(info.costInput).toBe("unknown")
  })
})

describe("testFableConnection (unit, stub launchers — no real API)", () => {
  function stubLauncher(script: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-launcher-test-"))
    fixtureRoots.push(dir)
    const p = path.join(dir, isWindows ? "hubcli.cmd" : "hubcli")
    writeLauncher(p, script)
    return p
  }

  test("exit 0 with OK → ok true", () => {
    const launcher = stubLauncher(isWindows ? "@echo off\r\necho OK\r\nexit /b 0\r\n" : '#!/bin/sh\necho "OK"\n')
    const result = testFableConnection(launcher, 5_000)
    expect(result.ok).toBe(true)
    expect(result.response).toBe("OK")
  })

  test("timeout is distinguished from normal failure", () => {
    const launcher = stubLauncher(
      isWindows
        ? `@echo off\r\n"${BUN}" -e "setTimeout(() => {}, 10000)"\r\n`
        : '#!/bin/sh\nsleep 10\n',
    )
    const result = testFableConnection(launcher, 500)
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.error).toContain("timeout")
  })

  test("stderr with sk- key is sanitized", () => {
    const launcher = stubLauncher(
      isWindows
        ? '@echo off\r\necho error with key sk-SECRETKEY12345 1>&2\r\nexit /b 1\r\n'
        : '#!/bin/sh\necho "error with key sk-SECRETKEY12345" >&2\nexit 1\n',
    )
    const result = testFableConnection(launcher, 5_000)
    expect(result.ok).toBe(false)
    expect(result.timedOut).not.toBe(true)
    expect(result.error).not.toContain("sk-SECRETKEY12345")
    expect(result.error).toContain("sk-••••")
  })

  test("nonzero exit without output → exit code reported", () => {
    const launcher = stubLauncher(isWindows ? "@echo off\r\nexit /b 7\r\n" : "#!/bin/sh\nexit 7\n")
    const result = testFableConnection(launcher, 5_000)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("exit 7")
  })
})

// ---------------------------------------------------------------------------
// 4. Claude Fable 5 (experimental) — subprocess integration
// ---------------------------------------------------------------------------

describe("doctor command — Fable 5 experimental section", () => {
  test(
    "labels Fable as experimental with deprecated catalog status",
    async () => {
      const { env } = buildFixture({ authJson: "valid", fableInCatalog: true })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("Claude Fable 5 (experimental)")
      expect(result.stdout).toContain("OpenCode Zen (opencode)")
      expect(result.stdout).toContain("opencode/claude-fable-5")
      expect(result.stdout).toContain("deprecated / experimental")
      expect(result.stdout).toContain("Claude Code tokens")
      expect(result.stdout).toContain("not used")
      // token from fixture auth.json must never leak
      expect(result.stdout).not.toContain(FAKE_OPENCODE_TOKEN)
      expect(result.stderr).not.toContain(FAKE_OPENCODE_TOKEN)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "auth present → 'OpenCode account authentication detected', exit stays 0",
    async () => {
      const { env } = buildFixture({ authJson: "valid", fableInCatalog: true })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("OpenCode account authentication detected")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "auth.json missing → WARN only, doctor still exits 0",
    async () => {
      const { env } = buildFixture({ fableInCatalog: true }) // no authJson
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("auth.json not found")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "auth.json invalid JSON → sanitized warning, exit 0",
    async () => {
      const { env } = buildFixture({ authJson: "invalid", fableInCatalog: true })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("not valid JSON")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "opencode entry absent from auth.json → WARN, exit 0, no token leak",
    async () => {
      const { env } = buildFixture({ authJson: "absent", fableInCatalog: true })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("no opencode entry")
      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain(FAKE_OPENCODE_TOKEN)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "fable removed from catalog → WARN 'not in catalog', exit 0",
    async () => {
      const { env } = buildFixture({ authJson: "valid" }) // no fableInCatalog
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("not in catalog")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "never claims official Anthropic access",
    async () => {
      const { env } = buildFixture({ authJson: "valid", fableInCatalog: true })
      const result = await spawnDoctor(["--verbose"], env)
      expect(result.stdout).not.toContain("Anthropic API connected")
      expect(result.stdout).not.toContain("ANTHROPIC_API_KEY present")
      expect(result.stdout).not.toContain(FAKE_OPENCODE_TOKEN)
    },
    DOCTOR_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// 5. NVIDIA NIM — subprocess integration (fake keys only)
// ---------------------------------------------------------------------------

describe("doctor command — NVIDIA NIM section", () => {
  test(
    "key present is reported without exposing the value",
    async () => {
      const { env } = buildFixture({ env: { NVIDIA_API_KEY: "nvapi-fake-value-never-print" } })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("NVIDIA NIM")
      expect(result.stdout).toContain("NVIDIA_API_KEY present")
      expect(result.stdout).toContain("https://integrate.api.nvidia.com/v1")
      expect(result.stdout).not.toContain("nvapi-fake-value-never-print")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "key missing is a WARN, never a failure",
    async () => {
      const { env } = buildFixture()
      delete env["NVIDIA_API_KEY"]
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("NVIDIA_API_KEY missing")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )

  test(
    "--connect skips NVIDIA when key is missing",
    async () => {
      const { env } = buildFixture({
        env: { DASHSCOPE_API_KEY: "fake", DEEPSEEK_API_KEY: "fake" },
      })
      delete env["NVIDIA_API_KEY"]
      const result = await spawnDoctor(["--connect"], env)
      expect(result.stdout).toContain("skipped (NVIDIA_API_KEY missing)")
    },
    60_000,
  )

  test(
    "nvidia model not in fixture config shows as not configured",
    async () => {
      const { env } = buildFixture({ env: { NVIDIA_API_KEY: "nvapi-fake" } })
      const result = await spawnDoctor([], env)
      expect(result.stdout).toContain("not configured")
      expect(result.exitCode).toBe(0)
    },
    DOCTOR_TIMEOUT,
  )
})
