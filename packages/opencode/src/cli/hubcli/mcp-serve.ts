/**
 * hubcli mcp serve — HubCli MCP Server (stdio, read-only).
 *
 * Registered ONLY when HUBCLI_BRAND=1. Exposes six read-only tools so MCP
 * clients (Codex CLI, Claude Code, …) can inspect the HubCli environment.
 *
 * Hard security rules enforced here:
 *   - stdout carries ONLY the MCP protocol; all logs go to stderr
 *   - no shell, no exec-with-string, args always as arrays, cwd fixed
 *   - never reads credential values, auth.json contents, or file contents
 *   - never accepts paths or commands from the client
 *   - no write operations of any kind (git or filesystem)
 *   - subprocess timeout + maxBuffer on every spawn; output truncated
 */

import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { cmd } from "../cmd/cmd"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import {
  sanitizeError,
  checkOpenCodeAuth,
  readZenCatalog,
  readConfig,
  testZenConnection,
} from "../cmd/doctor"
import { MODEL_REGISTRY, registryKey } from "./model-registry"

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000
const CONNECT_TIMEOUT_MS = 180_000
const MAX_FILES = 200
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_BUFFER = 1024 * 1024

const HOME = os.homedir()
const HUBCLI_CREDS = path.join(HOME, ".hubcli", "credentials.env")
const HUBCLI_LAUNCHER = path.join(HOME, ".local", "bin", "hubcli")
const SYNC_SCRIPT = path.join(HOME, "Hubcli", "script", "hubcli", "sync-upstream.sh")
const CREDENTIAL_VARS = ["DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "NVIDIA_API_KEY"]

// ---------------------------------------------------------------------------
// Helpers — every subprocess goes through here (no shell, fixed args)
// ---------------------------------------------------------------------------

function runGit(args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  if (r.error || r.status !== 0) return { ok: false, out: "" }
  return { ok: true, out: (r.stdout ?? "").toString() }
}

/** JSON-encode a result, truncating to MAX_RESPONSE_BYTES with an explicit flag. */
function jsonResult(data: Record<string, unknown>): { content: { type: "text"; text: string }[] } {
  let text = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    text = JSON.stringify({ ...data, truncated: true }, null, 2).slice(0, MAX_RESPONSE_BYTES)
  }
  return { content: [{ type: "text" as const, text }] }
}

/**
 * The MCP client spawns the launcher with its own cwd, but the launcher runs
 * bun with --cwd pointing at the source tree. The launcher preserves the
 * caller's directory in HUBCLI_CALLER_PWD (and PWD); prefer those.
 */
export function clientCwd(): string {
  const candidate = process.env["HUBCLI_CALLER_PWD"] ?? process.env["PWD"]
  if (candidate && fs.existsSync(candidate)) return candidate
  return process.cwd()
}

function octalPerms(p: string): string | null {
  try {
    return (fs.statSync(p).mode & 0o777).toString(8).padStart(3, "0")
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Tool implementations (exported for unit tests)
// ---------------------------------------------------------------------------

export function toolModels() {
  const { config } = readConfig()
  const defaultModel = config?.model ?? null
  const models = MODEL_REGISTRY.map((e) => {
    const key = registryKey(e)
    const whitelist = config?.provider?.[e.provider]?.whitelist
    const catalog = e.provider === "opencode" ? readZenCatalog(e.modelID) : null
    return {
      provider: e.provider,
      model_id: e.modelID,
      display_name: e.displayName,
      group: e.group,
      default: key === defaultModel,
      // Zen models need no whitelist; others must be whitelisted in config
      configured: e.provider === "opencode" ? true : (whitelist ?? []).includes(e.modelID),
      catalog_status: catalog ? (catalog.found ? catalog.status : "not-in-catalog") : "unknown",
      experimental: e.experimental,
      capabilities: e.capabilities,
    }
  })
  return jsonResult({ default_model: defaultModel, count: models.length, models, truncated: false })
}

export function toolDoctor(opts: { connect?: boolean; verbose?: boolean }) {
  const warnings: string[] = []
  const errors: string[] = []

  const { config, error: configError } = readConfig()
  if (configError) errors.push(`config: ${sanitizeError(configError).slice(0, 200)}`)

  const credsPerms = octalPerms(HUBCLI_CREDS)
  if (credsPerms && credsPerms !== "600") errors.push(`credentials.env permissions ${credsPerms} (expected 600)`)

  const launcherOk = fs.existsSync(HUBCLI_LAUNCHER)
  if (!launcherOk) errors.push("launcher missing at ~/.local/bin/hubcli")

  const auth = checkOpenCodeAuth()
  if (auth.state !== "present") warnings.push(`opencode auth: ${auth.state}`)

  const credentials_presence: Record<string, boolean> = {}
  for (const v of CREDENTIAL_VARS) {
    credentials_presence[v] = !!process.env[v]
    if (!process.env[v]) warnings.push(`${v} missing`)
  }

  const providers = Object.keys(config?.provider ?? {})
  providers.push("opencode") // implicit via auth.json

  let connect: Record<string, unknown> | undefined
  if (opts.connect) {
    const r = testZenConnection("opencode/gpt-5.2-codex", HUBCLI_LAUNCHER, CONNECT_TIMEOUT_MS)
    connect = { model: "opencode/gpt-5.2-codex", ok: r.ok, ms: r.ms, timed_out: r.timedOut ?? false, error: r.error ?? null }
    if (!r.ok) errors.push(`connect: ${sanitizeError(r.error ?? "unknown").slice(0, 200)}`)
  }

  const overall_status = errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS"
  return jsonResult({
    overall_status,
    default_model: config?.model ?? null,
    config: { valid: !configError, providers },
    providers,
    credentials_presence,
    ...(connect ? { connect } : {}),
    ...(opts.verbose ? { auth_state: auth.state, credentials_permissions: credsPerms } : {}),
    warnings,
    errors,
    truncated: false,
  })
}

const PROJECT_MARKERS: Record<string, string> = {
  "package.json": "node",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "Gemfile": "ruby",
  "pom.xml": "java",
  "build.gradle": "java",
  "composer.json": "php",
}

const LOCKFILES: Record<string, string> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "uv.lock": "uv",
  "poetry.lock": "poetry",
  "Cargo.lock": "cargo",
}

export function toolProjectStatus() {
  const cwd = clientCwd()
  const exists = fs.existsSync(cwd)
  if (!exists) return jsonResult({ cwd, exists: false, truncated: false })

  let entries: string[] = []
  try {
    entries = fs.readdirSync(cwd).slice(0, MAX_FILES)
  } catch {
    // unreadable directory — report what we can
  }

  const projectFiles = entries.filter((e) => e in PROJECT_MARKERS || e in LOCKFILES)
  const projectType = projectFiles.map((f) => PROJECT_MARKERS[f]).find(Boolean) ?? "unknown"
  const packageManager = entries.map((f) => LOCKFILES[f]).find(Boolean) ?? "unknown"

  const gitCheck = runGit(["rev-parse", "--is-inside-work-tree"], cwd)
  const isGit = gitCheck.ok && gitCheck.out.trim() === "true"

  let branch: string | null = null
  let staged = 0
  let modified = 0
  let untracked = 0
  let conflicted = 0
  if (isGit) {
    branch = runGit(["branch", "--show-current"], cwd).out.trim() || null
    const st = runGit(["status", "--porcelain"], cwd)
    for (const lineRaw of st.out.split("\n")) {
      if (!lineRaw) continue
      const x = lineRaw[0]
      const y = lineRaw[1]
      if (lineRaw.startsWith("??")) untracked++
      else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) conflicted++
      else {
        if (x !== " " && x !== "?") staged++
        if (y !== " " && y !== "?") modified++
      }
    }
  }

  return jsonResult({
    cwd,
    exists,
    is_git: isGit,
    branch,
    clean: isGit ? staged + modified + untracked + conflicted === 0 : null,
    staged,
    modified,
    untracked,
    conflicted,
    package_manager: packageManager,
    project_type: projectType,
    project_files: projectFiles,
    truncated: entries.length >= MAX_FILES,
  })
}

export function toolGitStatus() {
  const cwd = clientCwd()
  const gitCheck = runGit(["rev-parse", "--is-inside-work-tree"], cwd)
  if (!(gitCheck.ok && gitCheck.out.trim() === "true")) {
    return jsonResult({ cwd, is_git: false, truncated: false })
  }
  const branch = runGit(["branch", "--show-current"], cwd).out.trim() || null
  const status = runGit(["status", "--porcelain"], cwd).out
  const files = status
    .split("\n")
    .filter(Boolean)
    .slice(0, MAX_FILES)
    .map((l) => ({ state: l.slice(0, 2), file: l.slice(3) }))
  const lastCommit = runGit(["log", "-1", "--format=%h %s"], cwd).out.trim() || null
  return jsonResult({
    cwd,
    is_git: true,
    branch,
    clean: files.length === 0,
    files,
    last_commit: lastCommit,
    truncated: status.split("\n").filter(Boolean).length > MAX_FILES,
  })
}

function runMaintenanceScript(subcommand: "status" | "preview") {
  if (!fs.existsSync(SYNC_SCRIPT)) {
    return jsonResult({ ok: false, error: "sync-upstream.sh not found — run setup first", truncated: false })
  }
  const r = spawnSync("bash", [SYNC_SCRIPT, subcommand], {
    cwd: path.join(HOME, "Hubcli"),
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" },
  })
  const timedOut = r.error != null && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
  const out = sanitizeError((r.stdout ?? "").toString()).slice(0, MAX_RESPONSE_BYTES / 2)
  return jsonResult({
    ok: r.status === 0,
    timed_out: timedOut,
    exit_code: r.status ?? null,
    output: out,
    truncated: (r.stdout ?? "").length > MAX_RESPONSE_BYTES / 2,
  })
}

export function toolMaintenanceStatus() {
  return runMaintenanceScript("status")
}

export function toolMaintenancePreview(opts: { fetch?: boolean }) {
  if (opts.fetch) {
    return jsonResult({
      ok: false,
      error: "fetch is not allowed through this read-only tool — run `hubcli maintenance fetch` in a terminal",
      truncated: false,
    })
  }
  return runMaintenanceScript("preview")
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }

const NO_ARGS_SCHEMA = { type: "object" as const, properties: {}, additionalProperties: false }

/** Tool table — the ONLY tools this server will ever expose. All read-only. */
export const TOOLS: { name: string; description: string; inputSchema: object; handler: (args: Record<string, unknown>) => ToolResult }[] = [
  {
    name: "hubcli_doctor",
    description:
      "Read-only HubCli health check: config validity, default model, provider list, credential presence (never values), warnings and errors. Set connect=true to run one real connectivity probe (slow).",
    inputSchema: {
      type: "object",
      properties: {
        connect: { type: "boolean", description: "run one real connectivity probe (up to 180s)" },
        verbose: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: (args) => toolDoctor({ connect: args["connect"] === true, verbose: args["verbose"] === true }),
  },
  {
    name: "hubcli_models",
    description:
      "List HubCli validated models: provider, model_id, display_name, group, default flag, configured flag, catalog status, experimental flag and declared capabilities. No network access.",
    inputSchema: NO_ARGS_SCHEMA,
    handler: () => toolModels(),
  },
  {
    name: "hubcli_project_status",
    description:
      "Read-only status of the current working directory: git branch/cleanliness counters, package manager, project type and detected project files. Never reads file contents.",
    inputSchema: NO_ARGS_SCHEMA,
    handler: () => toolProjectStatus(),
  },
  {
    name: "hubcli_git_status",
    description:
      "Safe git status of the current working directory (fixed git arguments, read-only): branch, changed files (max 200) and last commit.",
    inputSchema: NO_ARGS_SCHEMA,
    handler: () => toolGitStatus(),
  },
  {
    name: "hubcli_maintenance_status",
    description: "HubCli fork maintenance status (read-only, no fetch): branch, remotes and upstream divergence.",
    inputSchema: NO_ARGS_SCHEMA,
    handler: () => toolMaintenanceStatus(),
  },
  {
    name: "hubcli_maintenance_preview",
    description:
      "Preview upstream sync (read-only, no fetch): incoming commits and potential conflicts. Requests to fetch are rejected.",
    inputSchema: {
      type: "object",
      properties: { fetch: { type: "boolean", description: "always rejected — this tool never fetches" } },
      additionalProperties: false,
    },
    handler: (args) => toolMaintenancePreview({ fetch: args["fetch"] === true }),
  },
]

export function buildServer(): Server {
  const server = new Server(
    { name: "hubcli", version: InstallationVersion },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name)
    if (!tool) {
      return { content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }], isError: true }
    }
    const rawArgs = req.params.arguments ?? {}
    if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
      return { content: [{ type: "text" as const, text: "Invalid arguments: expected an object" }], isError: true }
    }
    try {
      return tool.handler(rawArgs as Record<string, unknown>)
    } catch (e) {
      const msg = sanitizeError(e instanceof Error ? e.message : String(e)).slice(0, 300)
      return { content: [{ type: "text" as const, text: `Tool error: ${msg}` }], isError: true }
    }
  })

  return server
}

export const McpServeCommand = cmd({
  command: "serve",
  describe: "start the HubCli MCP server (stdio, read-only tools)",
  builder: (y) => y,
  async handler() {
    // stdout is reserved for the MCP protocol — never print anything else.
    const server = buildServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(`hubcli mcp serve: ready (v${InstallationVersion}, cwd=${clientCwd()})\n`)
    // Exit cleanly when the client closes stdin (EOF).
    await new Promise<void>((resolve) => {
      process.stdin.on("close", () => resolve())
      process.stdin.on("end", () => resolve())
    })
    await server.close().catch(() => {})
  },
})
