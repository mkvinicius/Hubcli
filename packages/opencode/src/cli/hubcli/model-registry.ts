/**
 * HubCli validated model registry — the canonical list of models confirmed by
 * real API calls. Used by `hubcli mcp serve` (hubcli_models tool) and by the
 * profile/routing layer.
 *
 * NOTE: packages/tui/src/hubcli/model-display.ts holds the same list for the
 * TUI selector (the TUI cannot import from this package). Both sides pin the
 * total count in tests, so a divergence fails CI. Post-MVP: unify in core.
 *
 * No API keys, no endpoints, no network calls.
 */

export interface RegistryEntry {
  provider: string
  modelID: string
  displayName: string
  group: string
  sortOrder: number
  experimental: boolean
  /** capabilities as declared by the models.dev catalog at validation time */
  capabilities: { tools: boolean; reasoning: boolean }
}

export const MODEL_REGISTRY: readonly RegistryEntry[] = [
  { provider: "opencode", modelID: "gpt-5.2",                    displayName: "GPT-5.2",                  group: "OpenAI",               sortOrder: 1,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "opencode", modelID: "gpt-5.2-codex",              displayName: "GPT-5.2 Codex",            group: "OpenAI",               sortOrder: 2,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "opencode", modelID: "kimi-k2.7-code",             displayName: "Kimi K2.7 Code",           group: "Kimi",                 sortOrder: 3,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "opencode", modelID: "kimi-k2.5",                  displayName: "Kimi K2.5",                group: "Kimi",                 sortOrder: 4,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "deepseek", modelID: "deepseek-v4-pro",            displayName: "DeepSeek V4 Pro",          group: "DeepSeek",             sortOrder: 5,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "deepseek", modelID: "deepseek-v4-flash",          displayName: "DeepSeek V4 Flash",        group: "DeepSeek",             sortOrder: 6,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "nvidia",   modelID: "minimaxai/minimax-m3",       displayName: "MiniMax M3 — NVIDIA",      group: "NVIDIA NIM",           sortOrder: 7,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "nvidia",   modelID: "minimaxai/minimax-m2.7",     displayName: "MiniMax M2.7 — NVIDIA",    group: "NVIDIA NIM",           sortOrder: 8,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "nvidia",   modelID: "deepseek-ai/deepseek-v4-pro",displayName: "DeepSeek V4 Pro — NVIDIA", group: "NVIDIA NIM",           sortOrder: 9,  experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "alibaba-token-plan", modelID: "qwen3.7-max",      displayName: "Qwen 3.7 Max",             group: "Alibaba Model Studio", sortOrder: 10, experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "alibaba-token-plan", modelID: "qwen3.6-plus",     displayName: "Qwen 3.6 Plus",            group: "Alibaba Model Studio", sortOrder: 11, experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "alibaba-token-plan", modelID: "qwen3.6-flash",    displayName: "Qwen 3.6 Flash",           group: "Alibaba Model Studio", sortOrder: 12, experimental: false, capabilities: { tools: true, reasoning: false } },
  { provider: "alibaba-token-plan", modelID: "glm-5.2",          displayName: "GLM-5.2",                  group: "GLM",                  sortOrder: 13, experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "alibaba-token-plan", modelID: "glm-5.1",          displayName: "GLM-5.1",                  group: "GLM",                  sortOrder: 14, experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "alibaba-token-plan", modelID: "glm-5",            displayName: "GLM-5",                    group: "GLM",                  sortOrder: 15, experimental: false, capabilities: { tools: true, reasoning: true } },
  { provider: "opencode", modelID: "claude-fable-5",             displayName: "Claude Fable 5",           group: "Experimental",         sortOrder: 16, experimental: true,  capabilities: { tools: true, reasoning: true } },
]

export function registryKey(e: { provider: string; modelID: string }): string {
  return `${e.provider}/${e.modelID}`
}

export function findRegistryEntry(full: string): RegistryEntry | undefined {
  return MODEL_REGISTRY.find((e) => registryKey(e) === full)
}
