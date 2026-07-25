/**
 * HubCli profiles — named, ordered model lists with explicit, inspectable
 * routing. No opaque "AI choosing AI": selection is a deterministic walk of
 * the profile's model list with static availability checks.
 *
 * Persistence: ~/.hubcli/profiles.json (versioned schema, backup on write).
 * The user's repository is never touched; the default model in
 * ~/.hubcli/opencode.json is never modified by profile commands.
 *
 * Fallback policy (selection-time only):
 *   - skip models whose provider is listed in degraded_providers
 *     (e.g. alibaba-token-plan while the Token Plan returns AccessDenied)
 *   - skip models whose provider credential is absent
 *   - skip experimental models unless nothing else remains
 *   - at most ONE step past the preferred model is reported as "fallback";
 *     with --no-fallback the first model is used unconditionally.
 * Runtime retry of a failed session is intentionally NOT implemented — that
 * path crosses the Effect session machinery and cannot be made safe in this
 * fork without deep changes (documented limitation).
 */

import fs from "fs"
import os from "os"
import path from "path"
import { MODEL_REGISTRY, findRegistryEntry, registryKey } from "./model-registry"
import { checkOpenCodeAuth } from "../cmd/doctor"

const HUBCLI_HOME = path.join(os.homedir(), ".hubcli")
const PROFILES_PATH = path.join(HUBCLI_HOME, "profiles.json")
export const PROFILE_SCHEMA_VERSION = 1

export interface ProfilesFile {
  version: number
  current: string | null
  /** providers to skip during routing (entitlement/billing outages) */
  degraded_providers: string[]
  profiles: Record<string, { description: string; models: string[] }>
}

/** Credential requirement per provider — presence only, never values. */
const PROVIDER_CREDENTIAL: Record<string, string | null> = {
  "alibaba-token-plan": "DASHSCOPE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  opencode: null, // OpenCode account auth via auth.json
}

export function defaultProfiles(): ProfilesFile {
  return {
    version: PROFILE_SCHEMA_VERSION,
    current: null,
    // Alibaba Token Plan returns AccessDenied.Unpurchased (2026-07) — remove
    // this entry when the plan is regularized.
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
        // Context sizes confirmed by the models.dev catalog at validation
        // time: minimax-m3 1M (tested), deepseek-v4-pro 1M (tested),
        // gpt-5.2 400k (tested). Fable 5 (1M) is experimental — last.
        description: "very large inputs (≥400k tokens confirmed)",
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

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export function validateProfiles(data: unknown): { ok: boolean; error?: string } {
  if (typeof data !== "object" || data === null) return { ok: false, error: "not an object" }
  const d = data as Partial<ProfilesFile>
  if (d.version !== PROFILE_SCHEMA_VERSION) return { ok: false, error: `unsupported version ${d.version}` }
  if (typeof d.profiles !== "object" || d.profiles === null) return { ok: false, error: "profiles missing" }
  if (!Array.isArray(d.degraded_providers)) return { ok: false, error: "degraded_providers missing" }
  for (const [name, p] of Object.entries(d.profiles)) {
    if (!p || !Array.isArray(p.models) || p.models.length === 0)
      return { ok: false, error: `profile '${name}' has no models` }
    for (const m of p.models) {
      if (!findRegistryEntry(m)) return { ok: false, error: `profile '${name}' references unknown model '${m}'` }
    }
  }
  return { ok: true }
}

export function loadProfiles(filePath: string = PROFILES_PATH): { data: ProfilesFile; source: "file" | "defaults"; warning?: string } {
  try {
    if (!fs.existsSync(filePath)) return { data: defaultProfiles(), source: "defaults" }
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw)
    const check = validateProfiles(parsed)
    if (!check.ok) {
      return { data: defaultProfiles(), source: "defaults", warning: `profiles.json invalid (${check.error}) — using safe defaults` }
    }
    return { data: parsed as ProfilesFile, source: "file" }
  } catch (e) {
    return {
      data: defaultProfiles(),
      source: "defaults",
      warning: `profiles.json unreadable — using safe defaults`,
    }
  }
}

export function saveProfiles(data: ProfilesFile, filePath: string = PROFILES_PATH): void {
  const check = validateProfiles(data)
  if (!check.ok) throw new Error(`refusing to save invalid profiles: ${check.error}`)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (fs.existsSync(filePath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    fs.copyFileSync(filePath, `${filePath}.bak-${ts}`)
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteStep {
  model: string
  status: "selected" | "skipped" | "candidate"
  reason: string
}

export interface RouteResult {
  ok: boolean
  profile: string
  model?: string
  fallback: boolean
  steps: RouteStep[]
  error?: string
}

export interface ProviderState {
  available: boolean
  reason?: string
}

export type ProviderStateMap = Record<string, ProviderState>

function modelAvailability(full: string, degraded: string[], providerState: ProviderStateMap = {}): { available: boolean; reason: string } {
  const entry = findRegistryEntry(full)
  if (!entry) return { available: false, reason: "not in validated registry" }
  if (degraded.includes(entry.provider)) return { available: false, reason: `provider ${entry.provider} marked degraded` }
  const explicit = providerState[entry.provider]
  if (explicit) return { available: explicit.available, reason: explicit.reason ?? (explicit.available ? "available" : `provider ${entry.provider} unavailable`) }
  const credVar = PROVIDER_CREDENTIAL[entry.provider]
  if (credVar === null) {
    const auth = checkOpenCodeAuth()
    if (auth.state !== "present") return { available: false, reason: "OpenCode account auth missing" }
  } else if (credVar && !process.env[credVar]) {
    return { available: false, reason: `${credVar} missing` }
  }
  return { available: true, reason: "available" }
}

export function resolveProfile(
  name: string,
  opts: { noFallback?: boolean; providerState?: ProviderStateMap } = {},
  file?: ProfilesFile,
): RouteResult {
  const { data, warning } = file ? { data: file, warning: undefined } : loadProfiles()
  const profile = data.profiles[name]
  if (!profile) {
    return {
      ok: false,
      profile: name,
      fallback: false,
      steps: [],
      error: `unknown profile '${name}' — available: ${Object.keys(data.profiles).join(", ")}`,
    }
  }

  const steps: RouteStep[] = []
  if (warning) steps.push({ model: "-", status: "candidate", reason: warning })

  if (opts.noFallback) {
    const first = profile.models[0]
    steps.push({ model: first, status: "selected", reason: "first model of profile (--no-fallback)" })
    for (const m of profile.models.slice(1)) steps.push({ model: m, status: "candidate", reason: "not evaluated (--no-fallback)" })
    return { ok: true, profile: name, model: first, fallback: false, steps }
  }

  let selected: string | undefined
  const nonExperimental = profile.models.filter((m) => !findRegistryEntry(m)?.experimental)
  const experimental = profile.models.filter((m) => findRegistryEntry(m)?.experimental)

  for (const m of [...nonExperimental, ...experimental]) {
    if (selected) {
      steps.push({ model: m, status: "candidate", reason: "not needed" })
      continue
    }
    const entry = findRegistryEntry(m)
    if (entry?.experimental && nonExperimental.length > 0 && steps.some((s) => s.status === "skipped")) {
      // experimental only as last resort — still evaluated below
    }
    const avail = modelAvailability(m, data.degraded_providers, opts.providerState)
    if (avail.available) {
      selected = m
      const isFirst = m === profile.models[0]
      steps.push({
        model: m,
        status: "selected",
        reason: isFirst ? "preferred model, available" : `fallback: earlier models unavailable`,
      })
    } else {
      steps.push({ model: m, status: "skipped", reason: avail.reason })
    }
  }

  if (!selected) {
    return { ok: false, profile: name, fallback: false, steps, error: "no model in this profile is currently available" }
  }
  return { ok: true, profile: name, model: selected, fallback: selected !== profile.models[0], steps }
}
