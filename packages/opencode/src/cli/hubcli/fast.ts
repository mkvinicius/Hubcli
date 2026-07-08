#!/usr/bin/env bun

import fs from "fs"
import os from "os"
import path from "path"
import { findRegistryEntry } from "./model-registry"

const HOME = os.homedir()
const HUBCLI_HOME = path.join(HOME, ".hubcli")
const PROFILES_PATH = path.join(HUBCLI_HOME, "profiles.json")
const CREDS_PATH = path.join(HUBCLI_HOME, "credentials.env")
const OPENCODE_AUTH = path.join(HOME, ".local", "share", "opencode", "auth.json")
// HUBCLI_VERSION is always injected by the launcher (installed or dev mode).
// This fallback only fires when fast.ts is invoked directly, bypassing the
// launcher — treat that as an unversioned dev invocation, same as
// InstallationVersion falling back to "local" in source mode.
const VERSION = process.env.HUBCLI_VERSION || "local"
const PROFILE_SCHEMA_VERSION = 1

interface ProfilesFile {
  version: number
  current: string | null
  degraded_providers: string[]
  profiles: Record<string, { description: string; models: string[] }>
}

function out(line = "") {
  process.stdout.write(line + "\n")
}

function err(line = "") {
  process.stderr.write(line + "\n")
}

function defaultProfiles(): ProfilesFile {
  return {
    version: PROFILE_SCHEMA_VERSION,
    current: null,
    degraded_providers: ["alibaba-token-plan"],
    profiles: {
      coding: {
        description: "programming and agentic work",
        models: [
          "opencode/gpt-5.2-codex",
          "opencode/kimi-k2.7-code",
          "nvidia/minimaxai/minimax-m3",
          "deepseek/deepseek-v4-pro",
        ],
      },
      fast: {
        description: "quick, cheap responses",
        models: ["deepseek/deepseek-v4-flash", "opencode/kimi-k2.5", "nvidia/minimaxai/minimax-m2.7"],
      },
      reasoning: {
        description: "deep reasoning tasks",
        models: ["opencode/gpt-5.2", "deepseek/deepseek-v4-pro", "nvidia/deepseek-ai/deepseek-v4-pro"],
      },
      review: {
        description: "code review and analysis",
        models: ["deepseek/deepseek-v4-pro", "opencode/gpt-5.2", "opencode/gpt-5.2-codex"],
      },
      "long-context": {
        description: "very large inputs (>=400k tokens confirmed)",
        models: [
          "nvidia/minimaxai/minimax-m3",
          "deepseek/deepseek-v4-pro",
          "opencode/gpt-5.2",
          "opencode/claude-fable-5",
        ],
      },
    },
  }
}

function validateProfiles(data: unknown): { ok: boolean; error?: string } {
  if (typeof data !== "object" || data === null) return { ok: false, error: "not an object" }
  const d = data as Partial<ProfilesFile>
  if (d.version !== PROFILE_SCHEMA_VERSION) return { ok: false, error: `unsupported version ${d.version}` }
  if (typeof d.profiles !== "object" || d.profiles === null) return { ok: false, error: "profiles missing" }
  if (!Array.isArray(d.degraded_providers)) return { ok: false, error: "degraded_providers missing" }
  for (const [name, profile] of Object.entries(d.profiles)) {
    if (!profile || !Array.isArray(profile.models) || profile.models.length === 0) {
      return { ok: false, error: `profile '${name}' has no models` }
    }
    for (const model of profile.models) {
      if (!findRegistryEntry(model)) return { ok: false, error: `profile '${name}' references unknown model '${model}'` }
    }
  }
  return { ok: true }
}

function loadProfiles(): { data: ProfilesFile; warning?: string } {
  try {
    if (!fs.existsSync(PROFILES_PATH)) return { data: defaultProfiles() }
    const parsed = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"))
    const check = validateProfiles(parsed)
    if (!check.ok) {
      return { data: defaultProfiles(), warning: `profiles.json invalid (${check.error}) - using safe defaults` }
    }
    return { data: parsed as ProfilesFile }
  } catch {
    return { data: defaultProfiles(), warning: "profiles.json unreadable - using safe defaults" }
  }
}

function octalPerms(filePath: string): string | null {
  try {
    return (fs.statSync(filePath).mode & 0o777).toString(8).padStart(3, "0")
  } catch {
    return null
  }
}

function checkOpenCodeAuth(authPath: string = OPENCODE_AUTH): { state: string; perms: string | null } {
  const perms = octalPerms(authPath)
  if (!fs.existsSync(authPath)) return { state: "missing-file", perms: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as { opencode?: unknown }
    if (!parsed || typeof parsed !== "object") return { state: "invalid-json", perms }
    if (!parsed.opencode) return { state: "provider-absent", perms }
    return { state: "present", perms }
  } catch (e) {
    return { state: e instanceof SyntaxError ? "invalid-json" : "unreadable", perms }
  }
}

function credsFileVariables(): Set<string> {
  const names = new Set<string>()
  try {
    for (const line of fs.readFileSync(CREDS_PATH, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
      names.add(trimmed.slice(0, trimmed.indexOf("=")))
    }
  } catch {
    // absent or unreadable is reported separately
  }
  return names
}

function showHelp() {
  process.stderr.write(`                        
█  █ █  █ █▀▀█ █▀▀ █   █
█▀▀█ █  █ █▀▀▄ █   █   █
▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀ ▀▀▀ ▀
Seu hub multi-LLM para programação no terminal.

Commands:
  hubcli completion                generate shell completion script
  hubcli acp                       start ACP (Agent Client Protocol) server
  hubcli mcp                       manage MCP (Model Context Protocol) servers
  hubcli [project]                 start HubCli tui                                        [default]
  hubcli attach <url>              attach to a running HubCli server
  hubcli run [message..]           run HubCli with a message
  hubcli debug                     debugging and troubleshooting tools
  hubcli providers                 manage AI providers and credentials               [aliases: auth]
  hubcli agent                     manage agents
  hubcli upgrade [target]          upgrade HubCli to the latest or a specific version
  hubcli uninstall                 uninstall HubCli and remove all related files
  hubcli serve                     starts a headless HubCli server
  hubcli web                       start HubCli server and open web interface
  hubcli models [provider]         list all available models
  hubcli stats                     show token usage and cost statistics
  hubcli export [sessionID]        export session data as JSON
  hubcli import <file>             import session data from JSON file or URL
  hubcli github                    manage GitHub agent
  hubcli pr <number>               fetch and checkout a GitHub PR branch, then run opencode
  hubcli session                   manage sessions
  hubcli plugin <module>           install plugin and update config                  [aliases: plug]
  hubcli db                        database tools
  hubcli doctor                    check HubCli environment and configuration
  hubcli maintenance <subcommand>  manutenção do HubCli — sincronize com o upstream OpenCode
  hubcli profile <subcommand>      manage HubCli model profiles
  hubcli route <subcommand>        inspect HubCli model routing
  hubcli auth <subcommand>         credential status for HubCli providers (values never shown)

Positionals:
  project  path to start opencode in                                                        [string]

Options:
  -h, --help          show help                                                            [boolean]
  -v, --version       show version number                                                  [boolean]
      --print-logs    print logs to stderr                                                 [boolean]
      --log-level     log level                 [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
      --pure          run without external plugins                                         [boolean]
      --port          port to listen on                                        [number] [default: 0]
      --hostname      hostname to listen on                          [string] [default: "127.0.0.1"]
      --mdns          enable mDNS service discovery (defaults hostname to 0.0.0.0)
                                                                          [boolean] [default: false]
      --mdns-domain   custom domain name for mDNS service (default: opencode.local)
                                                                [string] [default: "opencode.local"]
      --cors          additional domains to allow for CORS                     [array] [default: []]
  -m, --model         model to use in the format of provider/model                          [string]
  -c, --continue      continue the last session                                            [boolean]
  -s, --session       session id to continue                                                [string]
      --fork          fork the session when continuing (use with --continue or --session)  [boolean]
      --prompt        prompt to use                                                         [string]
      --agent         agent to use                                                          [string]
      --auto          auto-approve permissions that are not explicitly denied (dangerous!)
                                                                          [boolean] [default: false]
      --mini          start the minimal interactive interface             [boolean] [default: false]
      --no-replay     disable mini session history replay on resume and after resize       [boolean]
      --replay-limit  cap visible mini replay to the newest N messages                      [number]
`)
}

function profile(args: string[]) {
  const sub = args[0]
  const { data, warning } = loadProfiles()
  if (sub === "current") {
    out(data.current ?? "(none - set one with 'hubcli profile use <name>')")
    return
  }
  if (sub === "list") {
    if (warning) out(`WARN ${warning}`)
    for (const [name, profile] of Object.entries(data.profiles)) {
      const marker = data.current === name ? "* " : "  "
      out(`${marker}${name.padEnd(14)} ${profile.description} (${profile.models.length} models)`)
    }
    if (data.current) out(`\n(* = current, set via 'hubcli profile use <name>')`)
    return
  }
  if (sub === "show") {
    const name = args[1]
    if (!name) {
      err("Not enough non-option arguments: got 0, need at least 1")
      process.exitCode = 1
      return
    }
    if (warning) out(`WARN ${warning}`)
    const item = data.profiles[name]
    if (!item) {
      err(`unknown profile '${name}' - available: ${Object.keys(data.profiles).join(", ")}`)
      process.exitCode = 1
      return
    }
    out(`${name} - ${item.description}`)
    item.models.forEach((model, i) => {
      const entry = findRegistryEntry(model)
      out(`  ${i + 1}. ${model}${entry?.experimental ? " [experimental]" : ""}`)
    })
  }
}

function auth(args: string[]) {
  const sub = args[0]
  if (sub === "providers") {
    out("provider              auth mechanism")
    out("opencode (Zen)        OpenCode account — hubcli providers login")
    out("deepseek              DEEPSEEK_API_KEY in ~/.hubcli/credentials.env")
    out("nvidia (NIM)          NVIDIA_API_KEY in ~/.hubcli/credentials.env")
    out("alibaba-token-plan    DASHSCOPE_API_KEY in ~/.hubcli/credentials.env")
    out("openai (optional)     OPENAI_API_KEY — not configured by default")
    out("moonshotai (optional) MOONSHOT_API_KEY — not configured by default")
    return
  }
  if (sub !== "status") return

  const known = [
    { variable: "DASHSCOPE_API_KEY", provider: "alibaba-token-plan (Qwen/GLM)", required: false },
    { variable: "DEEPSEEK_API_KEY", provider: "deepseek", required: true },
    { variable: "NVIDIA_API_KEY", provider: "nvidia (NIM)", required: false },
    { variable: "OPENAI_API_KEY", provider: "openai (official, optional)", required: false },
    { variable: "MOONSHOT_API_KEY", provider: "moonshotai (official, optional)", required: false },
  ]
  const inFile = credsFileVariables()
  const perms = octalPerms(CREDS_PATH)
  out("Credentials file")
  out("  path         ~/.hubcli/credentials.env")
  out(`  exists       ${perms !== null ? "yes" : "no"}`)
  if (perms !== null) {
    out(`  permissions  ${perms === "600" ? "600 (secure)" : `${perms} (INSECURE - run: chmod 600 ~/.hubcli/credentials.env)`}`)
  }
  out("\nAPI keys")
  for (const spec of known) {
    const envPresent = !!process.env[spec.variable]
    const filePresent = inFile.has(spec.variable)
    const present = envPresent || filePresent
    const source = envPresent && filePresent ? "env+file" : envPresent ? "environment" : filePresent ? "credentials.env" : "-"
    const req = spec.required ? "" : " (optional)"
    out(`  ${spec.variable.padEnd(20)} ${(present ? "present" : "missing").padEnd(8)} ${source.padEnd(16)} ${spec.provider}${req}`)
  }
  const openCodeAuth = checkOpenCodeAuth()
  out("\nOpenCode account (Zen: GPT, Kimi, Fable)")
  out(`  auth.json    ${openCodeAuth.state === "present" ? "authenticated" : openCodeAuth.state}`)
  out("\nTo add a key: edit ~/.hubcli/credentials.env with your editor (never pass keys as CLI arguments).")
  out("For OpenCode account auth: hubcli providers login")
}

function route(args: string[]) {
  if (args[0] !== "explain") return
  const profileIndex = args.indexOf("--profile")
  const inline = args.find((arg) => arg.startsWith("--profile="))
  const profileName = inline?.slice("--profile=".length) || (profileIndex >= 0 ? args[profileIndex + 1] : "")
  if (!profileName) {
    err("Missing required argument: profile")
    process.exitCode = 1
    return
  }
  const noFallback = args.includes("--no-fallback")
  const { data, warning } = loadProfiles()
  const item = data.profiles[profileName]
  out(`profile:  ${profileName}`)
  if (!item) {
    out(`error:    unknown profile '${profileName}' - available: ${Object.keys(data.profiles).join(", ")}`)
    out("steps:")
    process.exitCode = 1
    return
  }
  const steps: { model: string; status: "selected" | "skipped" | "candidate"; reason: string }[] = []
  if (warning) steps.push({ model: "-", status: "candidate", reason: warning })
  let selected: string | undefined
  const ordered = noFallback
    ? item.models
    : [
        ...item.models.filter((model) => !findRegistryEntry(model)?.experimental),
        ...item.models.filter((model) => findRegistryEntry(model)?.experimental),
      ]
  for (const model of ordered) {
    if (selected) {
      steps.push({ model, status: "candidate", reason: noFallback ? "not evaluated (--no-fallback)" : "not needed" })
      continue
    }
    if (noFallback) {
      selected = model
      steps.push({ model, status: "selected", reason: "first model of profile (--no-fallback)" })
      continue
    }
    const entry = findRegistryEntry(model)
    const credVar = entry?.provider === "opencode" ? null : entry?.provider === "deepseek" ? "DEEPSEEK_API_KEY" : entry?.provider === "nvidia" ? "NVIDIA_API_KEY" : entry?.provider === "alibaba-token-plan" ? "DASHSCOPE_API_KEY" : undefined
    let reason = "available"
    if (!entry) reason = "not in validated registry"
    else if (data.degraded_providers.includes(entry.provider)) reason = `provider ${entry.provider} marked degraded`
    else if (credVar === null && checkOpenCodeAuth().state !== "present") reason = "OpenCode account auth missing"
    else if (credVar && !process.env[credVar]) reason = `${credVar} missing`
    if (reason === "available") {
      selected = model
      steps.push({ model, status: "selected", reason: model === item.models[0] ? "preferred model, available" : "fallback: earlier models unavailable" })
    } else {
      steps.push({ model, status: "skipped", reason })
    }
  }
  if (selected) out(`selected: ${selected}${selected !== item.models[0] ? "  (fallback)" : ""}`)
  else {
    out("error:    no model in this profile is currently available")
    process.exitCode = 1
  }
  out("steps:")
  for (const step of steps) {
    const icon = step.status === "selected" ? "->" : step.status === "skipped" ? "x" : "."
    out(`  ${icon} ${step.model.padEnd(36)} ${step.status.padEnd(9)} ${step.reason}`)
  }
}

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  out(VERSION)
} else if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  showHelp()
} else if (args[0] === "profile") {
  profile(args.slice(1))
} else if (args[0] === "auth") {
  auth(args.slice(1))
} else if (args[0] === "route") {
  route(args.slice(1))
}
