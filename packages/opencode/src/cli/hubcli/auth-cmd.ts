/**
 * hubcli auth — credential presence overview (HubCli-only).
 *
 * Shows ONLY: present/missing, source, permission status. Never a value,
 * never a prefix, never a suffix, never a length. Adding keys is done via a
 * secure editor on ~/.hubcli/credentials.env or the native OpenCode flow
 * (`hubcli providers login`) — never as a CLI argument.
 */

import fs from "fs"
import os from "os"
import path from "path"
import { cmd } from "../cmd/cmd"
import { checkOpenCodeAuth } from "../cmd/doctor"

const HUBCLI_CREDS = path.join(os.homedir(), ".hubcli", "credentials.env")

interface CredentialSpec {
  variable: string
  provider: string
  required: boolean
}

const KNOWN_CREDENTIALS: CredentialSpec[] = [
  { variable: "DASHSCOPE_API_KEY", provider: "alibaba-token-plan (Qwen/GLM)", required: false },
  { variable: "DEEPSEEK_API_KEY", provider: "deepseek", required: true },
  { variable: "NVIDIA_API_KEY", provider: "nvidia (NIM)", required: false },
  { variable: "OPENAI_API_KEY", provider: "openai (official, optional)", required: false },
  { variable: "MOONSHOT_API_KEY", provider: "moonshotai (official, optional)", required: false },
]

/** Which variable names exist in credentials.env — names only, values never read into output. */
function credsFileVariables(): Set<string> {
  const names = new Set<string>()
  try {
    const raw = fs.readFileSync(HUBCLI_CREDS, "utf8")
    for (const line of raw.split("\n")) {
      const t = line.trim()
      if (!t || t.startsWith("#") || !t.includes("=")) continue
      names.add(t.slice(0, t.indexOf("=")))
    }
  } catch {
    // absent or unreadable — reported separately
  }
  return names
}

function out(s: string) {
  process.stdout.write(s + "\n")
}

const StatusCmd = cmd({
  command: "status",
  describe: "credential presence overview (never shows values)",
  builder: (y) => y,
  handler() {
    const inFile = credsFileVariables()
    const perms = (() => {
      try {
        return (fs.statSync(HUBCLI_CREDS).mode & 0o777).toString(8).padStart(3, "0")
      } catch {
        return null
      }
    })()

    out("Credentials file")
    out(`  path         ~/.hubcli/credentials.env`)
    out(`  exists       ${perms !== null ? "yes" : "no"}`)
    if (perms !== null) out(`  permissions  ${perms === "600" ? "600 (secure)" : `${perms} (INSECURE — run: chmod 600 ~/.hubcli/credentials.env)`}`)

    out("\nAPI keys")
    for (const spec of KNOWN_CREDENTIALS) {
      const envPresent = !!process.env[spec.variable]
      const filePresent = inFile.has(spec.variable)
      const present = envPresent || filePresent
      const source = envPresent && filePresent ? "env+file" : envPresent ? "environment" : filePresent ? "credentials.env" : "-"
      const req = spec.required ? "" : " (optional)"
      out(`  ${spec.variable.padEnd(20)} ${(present ? "present" : "missing").padEnd(8)} ${source.padEnd(16)} ${spec.provider}${req}`)
    }

    const auth = checkOpenCodeAuth()
    out("\nOpenCode account (Zen: GPT, Kimi, Fable)")
    out(`  auth.json    ${auth.state === "present" ? "authenticated" : auth.state}`)

    out("\nTo add a key: edit ~/.hubcli/credentials.env with your editor (never pass keys as CLI arguments).")
    out("For OpenCode account auth: hubcli providers login")
  },
})

const ProvidersCmd = cmd({
  command: "providers",
  describe: "map of providers to their auth mechanism",
  builder: (y) => y,
  handler() {
    out("provider              auth mechanism")
    out("opencode (Zen)        OpenCode account — hubcli providers login")
    out("deepseek              DEEPSEEK_API_KEY in ~/.hubcli/credentials.env")
    out("nvidia (NIM)          NVIDIA_API_KEY in ~/.hubcli/credentials.env")
    out("alibaba-token-plan    DASHSCOPE_API_KEY in ~/.hubcli/credentials.env")
    out("openai (optional)     OPENAI_API_KEY — not configured by default")
    out("moonshotai (optional) MOONSHOT_API_KEY — not configured by default")
  },
})

export const AuthCommand = cmd({
  command: "auth <subcommand>",
  describe: "credential status for HubCli providers (values never shown)",
  builder: (y) => y.command(StatusCmd).command(ProvidersCmd).demandCommand(1),
  async handler() {},
})
