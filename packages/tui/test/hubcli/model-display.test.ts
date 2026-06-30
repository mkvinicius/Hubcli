import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import {
  getModelDisplay,
  compareHubcliModels,
  HUBCLI_MODEL_KEYS,
  type HubcliModelDisplay,
} from "../../src/hubcli/model-display"

describe("getModelDisplay", () => {
  test("returns display info for known Qwen models", () => {
    const d = getModelDisplay("alibaba-token-plan", "qwen3.7-max")
    expect(d).toBeDefined()
    expect(d!.name).toBe("Qwen 3.7 Max")
    expect(d!.category).toBe("Alibaba Model Studio")
    expect(d!.sortOrder).toBe(1)
  })

  test("returns display info for GLM models", () => {
    expect(getModelDisplay("alibaba-token-plan", "glm-5.2")!.name).toBe("GLM-5.2")
    expect(getModelDisplay("alibaba-token-plan", "glm-5.2")!.category).toBe("GLM")
    expect(getModelDisplay("alibaba-token-plan", "glm-5.1")!.sortOrder).toBe(5)
    expect(getModelDisplay("alibaba-token-plan", "glm-5")!.sortOrder).toBe(6)
  })

  test("returns display info for DeepSeek models", () => {
    const pro = getModelDisplay("deepseek", "deepseek-v4-pro")!
    expect(pro.name).toBe("DeepSeek V4 Pro")
    expect(pro.category).toBe("DeepSeek")
    expect(pro.sortOrder).toBe(7)

    const flash = getModelDisplay("deepseek", "deepseek-v4-flash")!
    expect(flash.name).toBe("DeepSeek V4 Flash")
    expect(flash.sortOrder).toBe(8)
  })

  test("returns undefined for unknown model — does not hide it", () => {
    expect(getModelDisplay("openai", "gpt-4o")).toBeUndefined()
    expect(getModelDisplay("alibaba-token-plan", "unknown-model")).toBeUndefined()
  })

  test("returns undefined for wrong provider/ID combination", () => {
    // DeepSeek model ID on wrong provider must not match
    expect(getModelDisplay("alibaba-token-plan", "deepseek-v4-pro")).toBeUndefined()
  })
})

describe("compareHubcliModels", () => {
  function entry(providerID: string, modelID: string, title: string) {
    return { providerID, modelID, title }
  }

  test("sorts the eight validated models in canonical order", () => {
    const models = [
      entry("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash"),
      entry("alibaba-token-plan", "glm-5", "GLM-5"),
      entry("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro"),
      entry("alibaba-token-plan", "qwen3.6-plus", "Qwen 3.6 Plus"),
      entry("alibaba-token-plan", "glm-5.2", "GLM-5.2"),
      entry("alibaba-token-plan", "qwen3.7-max", "Qwen 3.7 Max"),
      entry("alibaba-token-plan", "glm-5.1", "GLM-5.1"),
      entry("alibaba-token-plan", "qwen3.6-flash", "Qwen 3.6 Flash"),
    ]
    const sorted = [...models].sort(compareHubcliModels)
    const ids = sorted.map((m) => m.modelID)
    expect(ids).toEqual([
      "qwen3.7-max",
      "qwen3.6-plus",
      "qwen3.6-flash",
      "glm-5.2",
      "glm-5.1",
      "glm-5",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ])
  })

  test("pushes unknown models after known ones, then sorts by title", () => {
    const models = [
      entry("openai", "gpt-4o", "GPT-4o"),
      entry("alibaba-token-plan", "qwen3.7-max", "Qwen 3.7 Max"),
      entry("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ]
    const sorted = [...models].sort(compareHubcliModels)
    expect(sorted[0].modelID).toBe("qwen3.7-max")
    // unknown models fall to end, sorted alphabetically by title
    expect(sorted[1].modelID).toBe("claude-sonnet-4-6") // "Claude..." < "GPT..."
    expect(sorted[2].modelID).toBe("gpt-4o")
  })
})

describe("HUBCLI_MODEL_KEYS", () => {
  test("contains exactly eight known model keys", () => {
    expect(HUBCLI_MODEL_KEYS.size).toBe(8)
    expect(HUBCLI_MODEL_KEYS.has("alibaba-token-plan/qwen3.7-max")).toBe(true)
    expect(HUBCLI_MODEL_KEYS.has("deepseek/deepseek-v4-flash")).toBe(true)
    expect(HUBCLI_MODEL_KEYS.has("openai/gpt-4o")).toBe(false)
  })
})

describe("category grouping", () => {
  test("Qwen models share category Alibaba Model Studio", () => {
    const qwenModels = ["qwen3.7-max", "qwen3.6-plus", "qwen3.6-flash"]
    for (const id of qwenModels) {
      expect(getModelDisplay("alibaba-token-plan", id)!.category).toBe("Alibaba Model Studio")
    }
  })

  test("GLM models share category GLM", () => {
    const glmModels = ["glm-5", "glm-5.1", "glm-5.2"]
    for (const id of glmModels) {
      expect(getModelDisplay("alibaba-token-plan", id)!.category).toBe("GLM")
    }
  })

  test("GLM and Qwen are separated into different categories", () => {
    const qwenCat = getModelDisplay("alibaba-token-plan", "qwen3.7-max")!.category
    const glmCat = getModelDisplay("alibaba-token-plan", "glm-5.2")!.category
    expect(qwenCat).not.toBe(glmCat)
  })
})
