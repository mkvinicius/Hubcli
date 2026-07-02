/**
 * HubCli visual presentation layer for the model selector.
 *
 * This file is the single source of truth for how models appear in the TUI when
 * HUBCLI_BRAND=1. It contains NO API keys, NO endpoints, NO auth logic, and
 * NO network calls. The technical IDs sent to the backend are never changed here.
 *
 * All entries are based on models confirmed by real API calls.
 */

export const HUBCLI_BRAND = process.env.HUBCLI_BRAND === "1"

export interface HubcliModelDisplay {
  /** Friendly name shown in the TUI. Never sent to the API. */
  name: string
  /** Visual group header. Determines section in the model selector. */
  category: string
  /** Lower = appears first in the selector. */
  sortOrder: number
}

// providerID/modelID → display info
const DISPLAY_MAP: Readonly<Record<string, HubcliModelDisplay>> = {
  "alibaba-token-plan/qwen3.7-max":  { name: "Qwen 3.7 Max",      category: "Alibaba Model Studio", sortOrder: 1 },
  "alibaba-token-plan/qwen3.6-plus": { name: "Qwen 3.6 Plus",     category: "Alibaba Model Studio", sortOrder: 2 },
  "alibaba-token-plan/qwen3.6-flash":{ name: "Qwen 3.6 Flash",    category: "Alibaba Model Studio", sortOrder: 3 },
  "alibaba-token-plan/glm-5.2":      { name: "GLM-5.2",           category: "GLM",                  sortOrder: 4 },
  "alibaba-token-plan/glm-5.1":      { name: "GLM-5.1",           category: "GLM",                  sortOrder: 5 },
  "alibaba-token-plan/glm-5":        { name: "GLM-5",             category: "GLM",                  sortOrder: 6 },
  "deepseek/deepseek-v4-pro":        { name: "DeepSeek V4 Pro",   category: "DeepSeek",             sortOrder: 7 },
  "deepseek/deepseek-v4-flash":      { name: "DeepSeek V4 Flash", category: "DeepSeek",             sortOrder: 8 },
  // OpenAI models served by OpenCode Zen — validated by real calls (2026-07-02).
  // Auth: OpenCode account (auth.json). Not the official OpenAI provider.
  "opencode/gpt-5.2":                { name: "GPT-5.2",           category: "OpenAI",               sortOrder: 9 },
  "opencode/gpt-5.2-codex":          { name: "GPT-5.2 Codex",     category: "OpenAI",               sortOrder: 10 },
  // Kimi (Moonshot AI) served by OpenCode Zen — validated by real calls (2026-07-02).
  "opencode/kimi-k2.7-code":         { name: "Kimi K2.7 Code",    category: "Kimi",                 sortOrder: 11 },
  "opencode/kimi-k2.5":              { name: "Kimi K2.5",         category: "Kimi",                 sortOrder: 12 },
  // Experimental — not part of the main validated set
  "opencode/claude-fable-5":         { name: "Claude Fable 5",    category: "Experimental",         sortOrder: 13 },
}

/**
 * Returns HubCli display info for a model, or undefined if not in the
 * validated set. Unknown models pass through unchanged — never hidden.
 */
export function getModelDisplay(providerID: string, modelID: string): HubcliModelDisplay | undefined {
  return DISPLAY_MAP[`${providerID}/${modelID}`]
}

/**
 * Sort comparator for HubCli mode. Preserves the canonical order of the
 * validated models (Qwen → GLM → DeepSeek → OpenAI → Kimi → Experimental);
 * any unknown model falls to the end, then sorts by title.
 */
export function compareHubcliModels(
  a: { providerID: string; modelID: string; title: string },
  b: { providerID: string; modelID: string; title: string },
): number {
  const aOrder = DISPLAY_MAP[`${a.providerID}/${a.modelID}`]?.sortOrder ?? 999
  const bOrder = DISPLAY_MAP[`${b.providerID}/${b.modelID}`]?.sortOrder ?? 999
  if (aOrder !== bOrder) return aOrder - bOrder
  return a.title.localeCompare(b.title)
}

/**
 * Returns the set of model keys known to HubCli.
 * Used only for filtering when a provider returns models beyond the whitelist.
 */
export const HUBCLI_MODEL_KEYS = new Set(Object.keys(DISPLAY_MAP))
