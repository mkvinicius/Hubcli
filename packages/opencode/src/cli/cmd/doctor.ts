/**
 * hubcli doctor — local health check for the HubCli environment.
 *
 * This command is registered ONLY when HUBCLI_BRAND=1. The OpenCode original
 * is never affected.
 *
 * Security: never prints API keys, tokens, or any credential value.
 * Only reports present/missing/invalid-permissions.
 *
 * Exit codes:
 *   0 — all required checks passed
 *   1 — missing config file or structural error
 *   2 — insecure file permissions
 *   3 — connectivity failure (--connect / --all only)
 *   4 — MCP server failure (--mcp / --all only)
 */

import os from "os"
import fs from "fs"
import path from "path"
import { execSync, spawnSync } from "child_process"
import { cmd } from "./cmd"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOME = os.homedir()
const HUBCLI_HOME = path.join(HOME, ".hubcli")
const HUBCLI_CONFIG = path.join(HUBCLI_HOME, "opencode.json")
const HUBCLI_CREDS = path.join(HUBCLI_HOME, "credentials.env")
const HUBCLI_LAUNCHER = path.join(HOME, ".local", "bin", "hubcli")
const HUBCLI_SRC = path.join(HOME, "Hubcli")
// OpenCode internal auth — stores provider keys for opencode/opencode-go
const OPENCODE_AUTH = path.join(HOME, ".local", "share", "opencode", "auth.json")

// Base URLs from models.dev — used for connectivity checks only
const PROVIDER_ENDPOINTS: Record<string, { baseURL: string; keyEnv: string; testModel: string }> = {
  "alibaba-token-plan": {
    baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    keyEnv: "DASHSCOPE_API_KEY",
    testModel: "qwen3.7-max",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    testModel: "deepseek-v4-pro",
  },
}

const EXPECTED_MODELS = [
  "alibaba-token-plan/qwen3.7-max",
  "alibaba-token-plan/qwen3.6-plus",
  "alibaba-token-plan/qwen3.6-flash",
  "alibaba-token-plan/glm-5",
  "alibaba-token-plan/glm-5.1",
  "alibaba-token-plan/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
]

const CREDENTIAL_VARS = ["DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY"]

// Claude Fable 5 — EXPERIMENTAL. Served by the OpenCode Zen API through the
// `opencode` provider. Authentication comes from the OpenCode account
// (auth.json) — no Anthropic API key and no Claude Code tokens are involved.
// The catalog currently marks this model as deprecated, so all Fable checks
// are advisory (WARN) and never affect the doctor exit code.
const FABLE5_PROVIDER = "opencode"
const FABLE5_MODEL_ID = "claude-fable-5"
const FABLE5_FULL = `${FABLE5_PROVIDER}/${FABLE5_MODEL_ID}`

// OpenAI and Kimi models served by OpenCode Zen — validated by real calls
// (2026-07-02). Auth: OpenCode account (auth.json). These are NOT the official
// OpenAI/Moonshot providers; no OPENAI_API_KEY or MOONSHOT_API_KEY involved.
// NVIDIA NIM — native catalog provider, validated by real calls (2026-07-02).
// Advisory in the doctor (WARN on failure) — never affects the exit code.
//
// Known provider-side instability (observed 2026-07-02, post-upstream-merge):
// minimaxai/minimax-m3 returns intermittent server-side errors (HTTP 500
// internal_server_error mid-stream, empty non-stream responses, occasional
// HTTP 400). Verified with a MINIMAL direct request to the NVIDIA endpoint
// (no HubCli payload, no reasoning/tools/temperature): 0/8 succeeded. This is
// NOT a HubCli payload regression — the upstream merge did not change the
// @ai-sdk/openai-compatible request path. The AI SDK's automatic retries let
// `hubcli run` still succeed most of the time, but the raw provider is flaky.
// The probe therefore stays on M3 (the primary model) and reports provider
// instability as WARN; M3 must not be described as healthy while this holds.
const NVIDIA_PROVIDER = "nvidia"
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1"
const NVIDIA_KEY_ENV = "NVIDIA_API_KEY"
const NVIDIA_MODELS = ["minimaxai/minimax-m3", "minimaxai/minimax-m2.7", "deepseek-ai/deepseek-v4-pro"]
const NVIDIA_CONNECT_MODEL = "minimaxai/minimax-m3"

const ZEN_MODEL_GROUPS: { title: string; models: string[]; connectModel: string }[] = [
  { title: "OpenAI (via OpenCode Zen)", models: ["gpt-5.2", "gpt-5.2-codex"], connectModel: "gpt-5.2-codex" },
  { title: "Kimi (via OpenCode Zen)", models: ["kimi-k2.7-code", "kimi-k2.5"], connectModel: "kimi-k2.7-code" },
]
// models.dev cache written by OpenCode itself — source of truth for metadata
const MODELS_CACHE = path.join(HOME, ".cache", "opencode", "models.json")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Status = "OK" | "WARN" | "FAIL"

interface Check {
  label: string
  status: Status
  value: string
}

function line(label: string, value: string) {
  process.stdout.write(`  ${label.padEnd(28)} ${value}\n`)
}

function section(title: string) {
  process.stdout.write(`\n${title}\n`)
}

function shortPath(p: string): string {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p
}

/** Return "600" on macOS/Linux from stat mode. */
function octalPerms(filePath: string): string | null {
  try {
    const mode = fs.statSync(filePath).mode
    return (mode & 0o777).toString(8).padStart(3, "0")
  } catch {
    return null
  }
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function gitStatus(repoPath: string): string {
  try {
    if (!fs.existsSync(path.join(repoPath, ".git"))) return "not a git repository"
    const out = execSync(`git -C "${repoPath}" status --porcelain`, { encoding: "utf8", timeout: 5000 })
    return out.trim().length === 0 ? "clean" : "dirty"
  } catch {
    return "not found"
  }
}

/** Sanitize error messages: remove any sk- prefixed strings. Exported for testing. */
export function sanitizeError(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9]{4,}/g, "sk-••••")
    .replace(/nvapi-[A-Za-z0-9_-]{4,}/g, "nvapi-••••")
}

/**
 * Reduce a provider error (which may embed a raw JSON body) to a single short,
 * human-readable reason — never dumps the raw/partial JSON body. Used so the
 * doctor shows "request rejected by provider (HTTP 400)" instead of a truncated
 * `{"status":400,"title":"Bad Request","detail":"...` fragment.
 */
export function summarizeProviderError(msg: string): string {
  const s = sanitizeError(msg)
  if (/\btimeout\b/i.test(s)) return "timeout waiting for provider"
  const status = /\b(4\d\d|5\d\d)\b/.exec(s)?.[1] ?? /"status"\s*:\s*(\d{3})/.exec(s)?.[1]
  if (status) {
    const code = Number(status)
    if (code === 400) return "request rejected by provider (HTTP 400)"
    if (code === 401 || code === 403) return "authentication/authorization rejected (HTTP " + code + ")"
    if (code === 404) return "model or endpoint not found (HTTP 404)"
    if (code === 429) return "rate limited or out of quota (HTTP 429)"
    if (code >= 500) return "provider internal error (HTTP " + code + ")"
    return `provider error (HTTP ${code})`
  }
  if (/internal_server_error/i.test(s)) return "provider internal error (HTTP 500)"
  // no recognizable status: return a short, single-line, body-free snippet
  return s.replace(/\s+/g, " ").slice(0, 80)
}

// ---------------------------------------------------------------------------
// Connectivity test via direct fetch (OpenAI-compatible API)
// Never logs the key; uses process.env which was loaded by the launcher.
// ---------------------------------------------------------------------------

async function testConnection(providerID: string): Promise<ConnectResult> {
  const cfg = PROVIDER_ENDPOINTS[providerID]
  if (!cfg) return { ok: false, ms: 0, error: "unknown provider" }

  const key = process.env[cfg.keyEnv]
  if (!key) return { ok: false, ms: 0, error: `${cfg.keyEnv} not set` }

  const url = `${cfg.baseURL}/chat/completions`
  const body = JSON.stringify({
    model: cfg.testModel,
    messages: [{ role: "user", content: "Responda somente: OK" }],
    max_tokens: 20,
    stream: false,
  })

  const start = Date.now()
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })

    const ms = Date.now() - start

    if (!resp.ok) {
      const text = await resp.text().catch(() => "")
      return {
        ok: false,
        ms,
        httpStatus: resp.status,
        error: sanitizeError(`HTTP ${resp.status}: ${text.slice(0, 200)}`),
      }
    }

    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "(empty)"
    return { ok: true, ms, response: content }
  } catch (err: unknown) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, ms, error: sanitizeError(msg) }
  }
}

// ---------------------------------------------------------------------------
// OpenCode auth check — inspects auth.json structure only.
// Never reads, measures, or prints any part of the stored key.
// ---------------------------------------------------------------------------

export type AuthState = "present" | "missing-file" | "unreadable" | "invalid-json" | "provider-absent"

export function checkOpenCodeAuth(authPath: string = OPENCODE_AUTH): { state: AuthState; perms: string | null } {
  const perms = octalPerms(authPath)
  if (!fs.existsSync(authPath)) return { state: "missing-file", perms: null }
  let raw: string
  try {
    raw = fs.readFileSync(authPath, "utf8")
  } catch {
    return { state: "unreadable", perms }
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const entry = data[FABLE5_PROVIDER]
    if (typeof entry === "object" && entry !== null) return { state: "present", perms }
    return { state: "provider-absent", perms }
  } catch {
    return { state: "invalid-json", perms }
  }
}

// ---------------------------------------------------------------------------
// Catalog metadata — read from the models.dev cache OpenCode maintains.
// Values not present in the cache are reported as "unknown"; nothing is
// hardcoded so a catalog refresh cannot desynchronize the doctor output.
// ---------------------------------------------------------------------------

export interface FableCatalogInfo {
  found: boolean
  status: string
  context: string
  output: string
  costInput: string
  costOutput: string
}

export function readZenCatalog(modelID: string, cachePath: string = MODELS_CACHE): FableCatalogInfo {
  const unknown: FableCatalogInfo = {
    found: false,
    status: "unknown",
    context: "unknown",
    output: "unknown",
    costInput: "unknown",
    costOutput: "unknown",
  }
  try {
    const raw = fs.readFileSync(cachePath, "utf8")
    const data = JSON.parse(raw) as Record<string, { models?: Record<string, any> }>
    const model = data?.[FABLE5_PROVIDER]?.models?.[modelID]
    if (!model) return unknown
    return {
      found: true,
      status: typeof model.status === "string" ? model.status : "active",
      context: model.limit?.context != null ? String(model.limit.context) : "unknown",
      output: model.limit?.output != null ? String(model.limit.output) : "unknown",
      costInput: model.cost?.input != null ? `$${model.cost.input}/M` : "unknown",
      costOutput: model.cost?.output != null ? `$${model.cost.output}/M` : "unknown",
    }
  } catch {
    return unknown
  }
}

export function readFableCatalog(cachePath: string = MODELS_CACHE): FableCatalogInfo {
  return readZenCatalog(FABLE5_MODEL_ID, cachePath)
}

// ---------------------------------------------------------------------------
// Fable 5 connectivity test — delegates to the HubCli launcher so auth.json
// is read through the normal OpenCode stack (never extracts the key manually).
// Runs `hubcli run` only — never `hubcli doctor`, so no recursion is possible.
// ---------------------------------------------------------------------------

export interface ConnectResult {
  ok: boolean
  ms: number
  response?: string
  error?: string
  httpStatus?: number
  timedOut?: boolean
}

const FABLE_CONNECT_TIMEOUT_MS = 60_000
const FABLE_OUTPUT_LIMIT = 64 * 1024 // cap stdout/stderr capture

export function testZenConnection(
  modelFull: string,
  launcher: string = HUBCLI_LAUNCHER,
  timeoutMs: number = FABLE_CONNECT_TIMEOUT_MS,
): ConnectResult {
  const start = Date.now()
  // No shell, args as array, cwd inherited, no credentials in argv.
  const result = spawnSync(launcher, ["run", "--model", modelFull, "Responda somente: OK"], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: FABLE_OUTPUT_LIMIT,
    env: { ...process.env, HUBCLI_BRAND: "1" },
  })
  const ms = Date.now() - start
  const timedOut = result.error != null && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
  if (timedOut) {
    return { ok: false, ms, timedOut: true, error: `timeout after ${timeoutMs / 1000}s` }
  }
  if (result.error) {
    return { ok: false, ms, error: sanitizeError(result.error.message).slice(0, 200) }
  }
  if (result.status === 0) {
    const output = (result.stdout ?? "").slice(0, FABLE_OUTPUT_LIMIT).trim()
    return { ok: true, ms, response: output.slice(0, 200) }
  }
  const errText = sanitizeError(((result.stderr ?? "") + (result.stdout ?? "")).slice(0, FABLE_OUTPUT_LIMIT).trim()).slice(0, 200)
  return { ok: false, ms, error: errText || `exit ${result.status ?? "?"}` }
}

export function testFableConnection(
  launcher: string = HUBCLI_LAUNCHER,
  timeoutMs: number = FABLE_CONNECT_TIMEOUT_MS,
): ConnectResult {
  return testZenConnection(FABLE5_FULL, launcher, timeoutMs)
}

// ---------------------------------------------------------------------------
// Config reader — reads opencode.json without running the Effect runtime
// ---------------------------------------------------------------------------

export interface HubcliConfig {
  model?: string
  provider?: Record<string, { whitelist?: string[] }>
}

export function readConfig(): { config: HubcliConfig | null; error: string | null } {
  try {
    if (!fs.existsSync(HUBCLI_CONFIG)) return { config: null, error: "file not found" }
    const raw = fs.readFileSync(HUBCLI_CONFIG, "utf8")
    const parsed = JSON.parse(raw) as HubcliConfig
    return { config: parsed, error: null }
  } catch (e: unknown) {
    return { config: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Spawns the real MCP server through the launcher and performs an
 * initialize + tools/list handshake over stdio. 15s budget.
 */
export async function testMcpServer(
  launcher: string = HUBCLI_LAUNCHER,
): Promise<{ ok: boolean; tools: number; ms: number; error?: string }> {
  const { spawn } = await import("child_process")
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn(launcher, ["mcp", "serve"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, HUBCLI_BRAND: "1" },
    })
    let buffer = ""
    let done = false
    const finish = (r: { ok: boolean; tools: number; error?: string }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      proc.kill()
      resolve({ ...r, ms: Date.now() - start })
    }
    const timer = setTimeout(() => finish({ ok: false, tools: 0, error: "timeout after 15s" }), 15_000)
    proc.on("error", (e) => finish({ ok: false, tools: 0, error: sanitizeError(e.message).slice(0, 120) }))
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      for (const lineRaw of buffer.split("\n")) {
        try {
          const msg = JSON.parse(lineRaw)
          if (msg.id === 2 && msg.result?.tools) {
            finish({ ok: true, tools: msg.result.tools.length })
          }
        } catch {}
      }
    })
    proc.stdin.write(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"doctor","version":"1"}}}\n' +
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n' +
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    )
  })
}

async function runDoctor(opts: { connect: boolean; verbose: boolean; mcp: boolean }): Promise<number> {
  const checks: Check[] = []
  let exitCode = 0

  function addCheck(label: string, status: Status, value: string) {
    checks.push({ label, status, value })
    if (status === "FAIL" && exitCode < 1) exitCode = 1
  }

  // ── Runtime ──────────────────────────────────────────────────────────────
  section("Runtime")
  line("HubCli version", InstallationVersion)
  line("Bun", process.versions.bun ?? process.version)
  line("Node", process.version)
  line("OS", `${os.type()} ${os.release()}`)
  line("Arch", os.arch())
  line("CWD", process.env.PWD ?? process.cwd())
  line("HUBCLI_BRAND", process.env.HUBCLI_BRAND === "1" ? "1 (active)" : "not set")

  // ── Paths ─────────────────────────────────────────────────────────────────
  section("Paths")
  line("Launcher", shortPath(HUBCLI_LAUNCHER))
  line("Config", shortPath(HUBCLI_CONFIG))
  line("Credentials", shortPath(HUBCLI_CREDS))
  if (opts.verbose) {
    line("HubCli source", shortPath(HUBCLI_SRC))
    line("OPENCODE_CONFIG_DIR", process.env.OPENCODE_CONFIG_DIR ?? "(not set)")
  }

  // ── Security ──────────────────────────────────────────────────────────────
  section("Security")

  // credentials.env existence + permissions
  if (!fs.existsSync(HUBCLI_CREDS)) {
    line("Credentials file", "missing")
    addCheck("credentials-file", "WARN", "missing — add DASHSCOPE_API_KEY and DEEPSEEK_API_KEY")
  } else {
    line("Credentials file", "present")
    const perms = octalPerms(HUBCLI_CREDS)
    if (perms === "600") {
      line("Permissions", "600 (OK)")
      addCheck("credentials-perms", "OK", "600")
    } else {
      line("Permissions", `${perms ?? "unknown"} (INSECURE — run: chmod 600 ${shortPath(HUBCLI_CREDS)})`)
      addCheck("credentials-perms", "FAIL", `${perms ?? "unknown"} — must be 600`)
      if (exitCode < 2) exitCode = 2
    }
  }

  // credential vars (presence only, never value)
  for (const varName of CREDENTIAL_VARS) {
    const present = !!process.env[varName]
    line(varName, present ? "present" : "missing")
    addCheck(varName, present ? "OK" : "WARN", present ? "present" : "missing")
  }

  // ── Configuration ─────────────────────────────────────────────────────────
  section("Configuration")

  const { config, error: configError } = readConfig()
  if (configError || !config) {
    line("Config JSON", `ERROR: ${configError ?? "null"}`)
    addCheck("config-json", "FAIL", configError ?? "null")
  } else {
    line("Config JSON", "valid")
    addCheck("config-json", "OK", "valid")

    const defaultModel = config.model ?? "(none)"
    line("Default model", defaultModel)
    if (!config.model) addCheck("default-model", "WARN", "not set")

    const providers = Object.keys(config.provider ?? {})
    line("Providers", providers.join(", ") || "(none)")

    const whitelistedModels: string[] = []
    for (const [provID, provCfg] of Object.entries(config.provider ?? {})) {
      const apiKeyField = (provCfg as { options?: { apiKey?: string } }).options?.apiKey
      if (opts.verbose && apiKeyField) {
        // Show variable reference, not the resolved value
        line(`  ${provID} apiKey`, apiKeyField.startsWith("{env:") ? apiKeyField : "(configured)")
      }
      for (const modelID of provCfg.whitelist ?? []) {
        whitelistedModels.push(`${provID}/${modelID}`)
      }
    }
    line("Whitelisted models", String(whitelistedModels.length))
    if (opts.verbose) {
      for (const m of whitelistedModels) line(`  - ${m}`, "")
    }

    // Check expected models
    const missing = EXPECTED_MODELS.filter((m) => !whitelistedModels.includes(m))
    if (missing.length > 0) {
      line("Missing expected models", missing.join(", "))
      addCheck("expected-models", "WARN", `${missing.length} missing: ${missing.join(", ")}`)
    } else {
      addCheck("expected-models", "OK", "all 8 present")
    }
  }

  // ── File checks ───────────────────────────────────────────────────────────
  section("Checks")

  // Launcher
  if (!fs.existsSync(HUBCLI_LAUNCHER)) {
    line("Launcher", "MISSING")
    addCheck("launcher", "FAIL", "not found at " + shortPath(HUBCLI_LAUNCHER))
  } else if (!isExecutable(HUBCLI_LAUNCHER)) {
    line("Launcher", "not executable (run: chmod +x " + shortPath(HUBCLI_LAUNCHER) + ")")
    addCheck("launcher", "FAIL", "not executable")
  } else {
    line("Launcher", "OK")
    addCheck("launcher", "OK", "found and executable")
  }

  // Config file
  if (!fs.existsSync(HUBCLI_CONFIG)) {
    line("Config file", "MISSING")
    addCheck("config-file", "FAIL", "not found at " + shortPath(HUBCLI_CONFIG))
  } else if (!isReadable(HUBCLI_CONFIG)) {
    line("Config file", "not readable")
    addCheck("config-file", "FAIL", "not readable")
  } else {
    line("Config file", "OK")
    addCheck("config-file", "OK", "found and readable")
  }

  // Credentials file permissions (re-checked for addCheck)
  if (fs.existsSync(HUBCLI_CREDS)) {
    const perms = octalPerms(HUBCLI_CREDS)
    line("Credentials perms", perms === "600" ? "OK (600)" : `INSECURE (${perms})`)
  }

  // Git repo status
  const repoStatus = gitStatus(HUBCLI_SRC)
  line("Repository", repoStatus)
  if (repoStatus === "dirty") {
    addCheck("repository", "WARN", "uncommitted changes in " + shortPath(HUBCLI_SRC))
  } else if (repoStatus === "clean") {
    addCheck("repository", "OK", "clean")
  }

  // ── Claude Fable 5 (experimental) ─────────────────────────────────────────
  // All Fable checks are advisory (WARN at worst) — the model is experimental
  // and its absence must never fail the doctor.
  section("Claude Fable 5 (experimental)")
  line("Provider", `OpenCode Zen (${FABLE5_PROVIDER})`)
  line("Model", FABLE5_FULL)

  const fableCatalog = readFableCatalog()
  if (!fableCatalog.found) {
    line("Catalog status", "not in catalog")
    addCheck("fable5-catalog", "WARN", "model absent from models.json cache — experimental model may have been removed")
  } else {
    const statusLabel = fableCatalog.status === "deprecated" ? "deprecated / experimental" : fableCatalog.status
    line("Catalog status", statusLabel)
  }

  const fableAuth = checkOpenCodeAuth()
  const authLabels: Record<AuthState, string> = {
    "present": "OpenCode account authentication detected",
    "missing-file": "auth.json not found",
    "unreadable": "auth.json not readable",
    "invalid-json": "auth.json is not valid JSON",
    "provider-absent": "no opencode entry in auth.json",
  }
  line("Authentication", authLabels[fableAuth.state])
  line("Claude Code tokens", "not used")
  if (fableAuth.perms && fableAuth.state !== "missing-file") {
    line("Auth file perms", fableAuth.perms === "600" ? "600 (OK)" : `${fableAuth.perms} (consider: chmod 600)`)
  }
  addCheck(
    "fable5-auth",
    fableAuth.state === "present" ? "OK" : "WARN",
    fableAuth.state === "present" ? "opencode account auth found" : authLabels[fableAuth.state],
  )
  if (opts.verbose) {
    line("Auth file", shortPath(OPENCODE_AUTH))
    line("Context", fableCatalog.context)
    line("Max output", fableCatalog.output)
    line("Cost input", fableCatalog.costInput)
    line("Cost output", fableCatalog.costOutput)
  }

  // ── OpenAI / Kimi via OpenCode Zen ────────────────────────────────────────
  // Same OpenCode account auth as Fable. Advisory checks (WARN at worst).
  for (const group of ZEN_MODEL_GROUPS) {
    section(group.title)
    line("Provider", `OpenCode Zen (${FABLE5_PROVIDER})`)
    line("Authentication", authLabels[fableAuth.state])
    for (const m of group.models) {
      const info = readZenCatalog(m)
      line(`  ${FABLE5_PROVIDER}/${m}`, info.found ? info.status : "not in catalog")
      if (!info.found) {
        addCheck(`zen-${m}`, "WARN", `${m} absent from models.json cache`)
      }
      if (opts.verbose && info.found) {
        line("    Context", info.context)
        line("    Cost in/out", `${info.costInput} / ${info.costOutput}`)
      }
    }
  }

  // ── NVIDIA NIM ────────────────────────────────────────────────────────────
  // Advisory provider: key presence, endpoint and configured models. WARN only.
  section("NVIDIA NIM")
  line("Provider", NVIDIA_PROVIDER)
  line("Endpoint", NVIDIA_ENDPOINT)
  const nvidiaKeyPresent = !!process.env[NVIDIA_KEY_ENV]
  line("API key", nvidiaKeyPresent ? `${NVIDIA_KEY_ENV} present` : `${NVIDIA_KEY_ENV} missing`)
  addCheck("nvidia-key", nvidiaKeyPresent ? "OK" : "WARN", nvidiaKeyPresent ? "present" : `${NVIDIA_KEY_ENV} missing — add to credentials.env`)
  {
    const nvWhitelist = config?.provider?.[NVIDIA_PROVIDER]?.whitelist ?? []
    line("Configured models", nvWhitelist.length ? String(nvWhitelist.length) : "none")
    for (const m of NVIDIA_MODELS) {
      line(`  ${NVIDIA_PROVIDER}/${m}`, nvWhitelist.includes(m) ? "configured" : "not configured")
    }
  }

  // ── Profiles ──────────────────────────────────────────────────────────────
  section("Profiles")
  {
    const { loadProfiles } = await import("../hubcli/profiles")
    const { data: profilesData, source: profilesSource, warning: profilesWarning } = loadProfiles()
    line("Profiles file", profilesSource === "file" ? "~/.hubcli/profiles.json" : "defaults (no file)")
    line("Profiles", Object.keys(profilesData.profiles).join(", "))
    line("Current", profilesData.current ?? "(none)")
    if (profilesData.degraded_providers.length > 0) {
      line("Degraded providers", profilesData.degraded_providers.join(", "))
    }
    if (profilesWarning) {
      addCheck("profiles", "WARN", profilesWarning)
    } else {
      addCheck("profiles", "OK", `${Object.keys(profilesData.profiles).length} valid profiles (${profilesSource})`)
    }
  }

  // ── Integrations (presence only — file contents never printed) ───────────
  section("Integrations")
  {
    const codexConfig = path.join(HOME, ".codex", "config.toml")
    let codexRegistered = false
    try {
      codexRegistered = fs.readFileSync(codexConfig, "utf8").includes("[mcp_servers.hubcli]")
    } catch {}
    line("Codex CLI", codexRegistered ? "hubcli MCP server registered" : "not registered")
    addCheck("integration-codex", codexRegistered ? "OK" : "WARN", codexRegistered ? "registered" : "run: codex mcp add hubcli -- ~/.local/bin/hubcli mcp serve")

    const claudeConfig = path.join(HOME, ".claude.json")
    let claudeRegistered = false
    try {
      const parsed = JSON.parse(fs.readFileSync(claudeConfig, "utf8")) as { mcpServers?: Record<string, unknown> }
      claudeRegistered = !!parsed.mcpServers && "hubcli" in parsed.mcpServers
    } catch {}
    line("Claude Code", claudeRegistered ? "hubcli MCP server registered" : "not registered")
    addCheck("integration-claude", claudeRegistered ? "OK" : "WARN", claudeRegistered ? "registered" : "run: claude mcp add --scope user hubcli -- ~/.local/bin/hubcli mcp serve")
  }

  // ── MCP server (--mcp / --all) — spawns the real server over stdio ───────
  if (opts.mcp) {
    section("MCP server")
    const mcpResult = await testMcpServer()
    if (mcpResult.ok) {
      line("hubcli mcp serve", `OK — ${mcpResult.tools} tools in ${(mcpResult.ms / 1000).toFixed(1)}s`)
      addCheck("mcp-server", "OK", `${mcpResult.tools} tools`)
    } else {
      line("hubcli mcp serve", `FAILED — ${mcpResult.error}`)
      addCheck("mcp-server", "FAIL", mcpResult.error ?? "unknown")
      if (exitCode === 0) exitCode = 4
    }
  }

  // ── Connectivity ──────────────────────────────────────────────────────────
  if (opts.connect) {
    section("Connectivity")

    // Fable 5 (experimental) — advisory only. Failure is a WARN and never
    // changes the exit code; only the required providers below can do that.
    process.stdout.write(`  Testing Claude Fable 5...`)
    const fableResult = testFableConnection()
    const fableTiming = `${(fableResult.ms / 1000).toFixed(1)}s`
    if (fableResult.ok) {
      process.stdout.write(`\r  ${"Claude Fable 5 (exp)".padEnd(26)} OK (${fableTiming})\n`)
      addCheck(`connect-${FABLE5_FULL}`, "OK", `${fableResult.ms}ms`)
    } else {
      const kind = fableResult.timedOut ? "TIMEOUT" : "UNAVAILABLE"
      process.stdout.write(
        `\r  ${"Claude Fable 5 (exp)".padEnd(26)} ${kind} (${fableTiming}) — ${sanitizeError(fableResult.error ?? "unknown")} [experimental — not required]\n`,
      )
      addCheck(`connect-${FABLE5_FULL}`, "WARN", `experimental model unavailable: ${fableResult.error ?? "unknown"}`)
    }
    if (opts.verbose && fableResult.response) {
      line("  Response", fableResult.response)
    }

    // OpenAI + Kimi via OpenCode Zen — REQUIRED as a group: the Zen
    // connection is considered functional if at least one model responds.
    // Individual model failures are WARN; all failing → FAIL (exit 3).
    let zenAnyOk = false
    for (const group of ZEN_MODEL_GROUPS) {
      const full = `${FABLE5_PROVIDER}/${group.connectModel}`
      const label = `${group.connectModel} (zen)`
      process.stdout.write(`  Testing ${full}...`)
      const zr = testZenConnection(full)
      const zt = `${(zr.ms / 1000).toFixed(1)}s`
      if (zr.ok) {
        zenAnyOk = true
        process.stdout.write(`\r  ${label.padEnd(26)} OK (${zt})\n`)
        addCheck(`connect-${full}`, "OK", `${zr.ms}ms`)
      } else {
        const kind = zr.timedOut ? "TIMEOUT" : "UNAVAILABLE"
        const zreason = zr.timedOut ? "timeout waiting for provider" : summarizeProviderError(zr.error ?? "unknown")
        process.stdout.write(`\r  ${label.padEnd(26)} ${kind} (${zt}) — ${zreason}\n`)
        addCheck(`connect-${full}`, "WARN", `zen model unavailable: ${zreason}`)
      }
    }
    if (!zenAnyOk) {
      addCheck("connect-opencode-zen", "FAIL", "no OpenCode Zen model reachable (gpt-5.2-codex, kimi-k2.7-code)")
      if (exitCode < 3) exitCode = 3
    }

    // NVIDIA NIM — advisory (WARN on failure). Skipped when the key is absent.
    if (nvidiaKeyPresent) {
      const nvFull = `${NVIDIA_PROVIDER}/${NVIDIA_CONNECT_MODEL}`
      process.stdout.write(`  Testing ${nvFull}...`)
      const nr = testZenConnection(nvFull)
      const nt = `${(nr.ms / 1000).toFixed(1)}s`
      if (nr.ok) {
        process.stdout.write(`\r  ${"NVIDIA NIM".padEnd(26)} OK (${nt})\n`)
        addCheck(`connect-${nvFull}`, "OK", `${nr.ms}ms`)
      } else {
        // Advisory: never fails the doctor. Show a sanitized, body-free reason
        // (no raw/partial JSON) in the Status/Probe/Reason/Action format.
        const reason = nr.timedOut ? "timeout waiting for provider" : summarizeProviderError(nr.error ?? "unknown")
        process.stdout.write(`\r  ${"NVIDIA NIM".padEnd(26)} WARNING (${nt})\n`)
        line("  Status", "warning")
        line("  Probe model", nvFull)
        line("  Reason", reason)
        line("  Action", "verify model compatibility / provider may be temporarily unstable")
        addCheck(`connect-${nvFull}`, "WARN", `${reason} — verify model compatibility`)
      }
    } else {
      line("NVIDIA NIM", `skipped (${NVIDIA_KEY_ENV} missing)`)
    }

    for (const [providerID, provCfg] of Object.entries(PROVIDER_ENDPOINTS)) {
      const isAlibaba = providerID === "alibaba-token-plan"
      const label = isAlibaba ? "Alibaba Token Plan" : "DeepSeek"
      process.stdout.write(`  Testing ${label}...`)
      const result = await testConnection(providerID)
      const timing = `${(result.ms / 1000).toFixed(1)}s`
      if (result.ok) {
        process.stdout.write(`\r  ${label.padEnd(26)} OK (${timing})\n`)
        addCheck(`connect-${providerID}`, "OK", `${result.ms}ms`)
      } else if (isAlibaba) {
        // Alibaba is DEGRADED, not required, while the Token Plan is not
        // regularized. Never fails the doctor; the reason is summarized
        // without echoing the raw API response body.
        const entitlement = (result.error ?? "").includes("Unpurchased") || result.httpStatus === 403
        process.stdout.write(`\r  ${label.padEnd(26)} UNAVAILABLE (${timing})\n`)
        line("  Status", "unavailable")
        line("  Reason", entitlement ? "plan or model entitlement" : summarizeProviderError(result.error ?? "unknown"))
        line("  Action", "verify Token Plan subscription")
        addCheck(`connect-${providerID}`, "WARN", entitlement ? "plan or model entitlement — verify Token Plan subscription" : `unavailable: ${summarizeProviderError(result.error ?? "unknown")}`)
      } else {
        // Required provider (DeepSeek) failure → exit 3. Reason is summarized
        // so no raw/partial JSON body is printed.
        const reason = summarizeProviderError(result.error ?? `HTTP ${result.httpStatus ?? "?"}`)
        process.stdout.write(`\r  ${label.padEnd(26)} FAILED (${timing}) — ${reason}\n`)
        addCheck(`connect-${providerID}`, "FAIL", reason)
        if (exitCode < 3) exitCode = 3
      }
      if (opts.verbose && result.response) {
        line("  Response", result.response)
      }
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  section("Result")
  const fails = checks.filter((c) => c.status === "FAIL")
  const warns = checks.filter((c) => c.status === "WARN")

  if (fails.length === 0 && warns.length === 0) {
    process.stdout.write("  All checks passed.\n")
  } else {
    if (fails.length > 0) {
      process.stdout.write(`  ${fails.length} check(s) failed:\n`)
      for (const f of fails) process.stdout.write(`    - ${f.label}: ${f.value}\n`)
    }
    if (warns.length > 0) {
      process.stdout.write(`  ${warns.length} warning(s):\n`)
      for (const w of warns) process.stdout.write(`    - ${w.label}: ${w.value}\n`)
    }
  }
  process.stdout.write("\n")

  return exitCode
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check HubCli environment and configuration",
  builder: (yargs) =>
    yargs
      .option("connect", {
        alias: "c",
        type: "boolean",
        default: false,
        describe: "run connectivity tests against configured providers (makes real API calls)",
      })
      .option("verbose", {
        type: "boolean",
        default: false,
        describe: "show additional details (endpoints, model list, apiKey variable names)",
      })
      .option("mcp", {
        type: "boolean",
        default: false,
        describe: "spawn the MCP server and verify the stdio handshake",
      })
      .option("all", {
        type: "boolean",
        default: false,
        describe: "run every check (equivalent to --connect --mcp)",
      }),
  async handler(args) {
    process.exitCode = await runDoctor({
      connect: !!args.connect || !!args.all,
      verbose: !!args.verbose,
      mcp: !!args.mcp || !!args.all,
    })
  },
})
