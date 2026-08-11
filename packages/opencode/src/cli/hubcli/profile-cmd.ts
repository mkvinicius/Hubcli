/**
 * hubcli profile — manage HubCli model profiles.
 * hubcli route  — explain routing decisions.
 *
 * Registered ONLY when HUBCLI_BRAND=1. Never touches the user's repository
 * or the default model in opencode.json.
 */

import { cmd } from "../cmd/cmd"
import { loadProfiles, saveProfiles, resolveProfile } from "./profiles"
import { findRegistryEntry } from "./model-registry"

function out(s: string) {
  process.stdout.write(s + "\n")
}

const ListCmd = cmd({
  command: "list",
  describe: "list available profiles",
  builder: (y) => y,
  handler() {
    const { data, warning } = loadProfiles()
    if (warning) out(`⚠ ${warning}`)
    for (const [name, p] of Object.entries(data.profiles)) {
      const marker = data.current === name ? "* " : "  "
      out(`${marker}${name.padEnd(14)} ${p.description} (${p.models.length} models)`)
    }
    if (data.current) out(`\n(* = current, set via 'hubcli profile use <name>')`)
  },
})

const ShowCmd = cmd({
  command: "show <name>",
  describe: "show a profile's models in priority order",
  builder: (y) => y.positional("name", { type: "string", demandOption: true }),
  handler(args: { name: string }) {
    const { data, warning } = loadProfiles()
    if (warning) out(`⚠ ${warning}`)
    const p = data.profiles[args.name]
    if (!p) {
      process.stderr.write(`unknown profile '${args.name}' — available: ${Object.keys(data.profiles).join(", ")}\n`)
      process.exitCode = 1
      return
    }
    out(`${args.name} — ${p.description}`)
    p.models.forEach((m, i) => {
      const entry = findRegistryEntry(m)
      const exp = entry?.experimental ? " [experimental]" : ""
      out(`  ${i + 1}. ${m}${exp}`)
    })
  },
})

const UseCmd = cmd({
  command: "use <name>",
  describe: "set the current profile (does not change the default model)",
  builder: (y) => y.positional("name", { type: "string", demandOption: true }),
  handler(args: { name: string }) {
    const { data, warning } = loadProfiles()
    if (warning) out(`⚠ ${warning}`)
    if (!data.profiles[args.name]) {
      process.stderr.write(`unknown profile '${args.name}' — available: ${Object.keys(data.profiles).join(", ")}\n`)
      process.exitCode = 1
      return
    }
    data.current = args.name
    saveProfiles(data)
    out(`current profile: ${args.name}`)
    out(`use it with: hubcli run --profile ${args.name} "..."`)
  },
})

const CurrentCmd = cmd({
  command: "current",
  describe: "show the current profile",
  builder: (y) => y,
  handler() {
    const { data } = loadProfiles()
    out(data.current ?? "(none — set one with 'hubcli profile use <name>')")
  },
})

export const ProfileCommand = cmd({
  command: "profile <subcommand>",
  describe: "manage HubCli model profiles",
  builder: (y) => y.command(ListCmd).command(ShowCmd).command(UseCmd).command(CurrentCmd).demandCommand(1),
  async handler() {},
})

const RouteExplainCmd = cmd({
  command: "explain",
  describe: "show which model a profile would select and why",
  builder: (y) =>
    y
      .option("profile", { type: "string", demandOption: true, describe: "profile name" })
      .option("no-fallback", { type: "boolean", default: false, describe: "always use the profile's first model" }),
  handler(args: { profile: string; noFallback?: boolean }) {
    const result = resolveProfile(args.profile, { noFallback: !!args.noFallback })
    out(`profile:  ${result.profile}`)
    if (!result.ok) {
      out(`error:    ${result.error}`)
      process.exitCode = 1
    } else {
      out(`selected: ${result.model}${result.fallback ? "  (fallback)" : ""}`)
    }
    out("steps:")
    for (const s of result.steps) {
      const icon = s.status === "selected" ? "→" : s.status === "skipped" ? "✗" : "·"
      out(`  ${icon} ${s.model.padEnd(36)} ${s.status.padEnd(9)} ${s.reason}`)
    }
  },
})

export const RouteCommand = cmd({
  command: "route <subcommand>",
  describe: "inspect HubCli model routing",
  builder: (y) => y.command(RouteExplainCmd).demandCommand(1),
  async handler() {},
})
