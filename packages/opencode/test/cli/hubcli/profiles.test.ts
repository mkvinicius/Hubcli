/**
 * Tests for HubCli profiles and routing. Pure fixtures — no real credentials,
 * no network, no writes outside temp dirs.
 */

import { describe, test, expect, afterAll } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  defaultProfiles,
  validateProfiles,
  loadProfiles,
  saveProfiles,
  resolveProfile,
  type ProfilesFile,
} from "../../../src/cli/hubcli/profiles"

let tmpDirs: string[] = []
function tmpfile(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hubcli-profiles-test-"))
  tmpDirs.push(d)
  return path.join(d, name)
}
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {}
  }
})

describe("defaultProfiles", () => {
  test("ships the five initial profiles and validates", () => {
    const d = defaultProfiles()
    expect(Object.keys(d.profiles).sort()).toEqual(["coding", "fast", "long-context", "reasoning", "review"])
    expect(validateProfiles(d).ok).toBe(true)
  })

  test("alibaba is degraded by default while the Token Plan is unavailable", () => {
    expect(defaultProfiles().degraded_providers).toContain("alibaba-token-plan")
  })

  test("Fable is never a profile's primary model", () => {
    for (const [, p] of Object.entries(defaultProfiles().profiles)) {
      expect(p.models[0]).not.toBe("opencode/claude-fable-5")
    }
  })
})

describe("validateProfiles", () => {
  test("rejects unknown model references", () => {
    const d = defaultProfiles()
    d.profiles["bad"] = { description: "x", models: ["fake/model-that-does-not-exist"] }
    expect(validateProfiles(d).ok).toBe(false)
  })

  test("rejects wrong schema version", () => {
    const d = defaultProfiles() as ProfilesFile & { version: number }
    d.version = 99
    expect(validateProfiles(d).ok).toBe(false)
  })

  test("rejects empty model lists", () => {
    const d = defaultProfiles()
    d.profiles["empty"] = { description: "x", models: [] }
    expect(validateProfiles(d).ok).toBe(false)
  })
})

describe("loadProfiles — safe fallback", () => {
  test("missing file → defaults", () => {
    const { data, source } = loadProfiles("/nonexistent/profiles.json")
    expect(source).toBe("defaults")
    expect(validateProfiles(data).ok).toBe(true)
  })

  test("invalid JSON → defaults with warning", () => {
    const p = tmpfile("profiles.json")
    fs.writeFileSync(p, "{ broken !!", "utf8")
    const { source, warning } = loadProfiles(p)
    expect(source).toBe("defaults")
    expect(warning).toBeDefined()
  })

  test("valid file with unknown model → defaults with warning", () => {
    const p = tmpfile("profiles.json")
    const bad = defaultProfiles()
    bad.profiles["coding"].models = ["nope/nothing"]
    fs.writeFileSync(p, JSON.stringify(bad), "utf8")
    const { source, warning } = loadProfiles(p)
    expect(source).toBe("defaults")
    expect(warning).toContain("invalid")
  })
})

describe("saveProfiles", () => {
  test("creates a timestamped backup before overwriting", () => {
    const p = tmpfile("profiles.json")
    saveProfiles(defaultProfiles(), p)
    const d2 = defaultProfiles()
    d2.current = "fast"
    saveProfiles(d2, p)
    const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.includes(".bak-"))
    expect(backups.length).toBe(1)
    expect(JSON.parse(fs.readFileSync(p, "utf8")).current).toBe("fast")
  })

  test("refuses to save invalid data", () => {
    const p = tmpfile("profiles.json")
    const bad = defaultProfiles()
    bad.profiles["x"] = { description: "", models: ["fake/x"] }
    expect(() => saveProfiles(bad, p)).toThrow()
  })
})

describe("resolveProfile — routing and limited fallback", () => {
  // fixture with full control — never touches ~/.hubcli
  function fixture(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
    return { ...defaultProfiles(), ...overrides }
  }

  test("unknown profile → error with available list", () => {
    const r = resolveProfile("nope", {}, fixture())
    expect(r.ok).toBe(false)
    expect(r.error).toContain("coding")
  })

  test("first model selected when its provider is healthy", () => {
    // coding starts with opencode/gpt-5.2-codex — opencode auth exists on this machine
    const r = resolveProfile("coding", {}, fixture())
    expect(r.ok).toBe(true)
    expect(r.model).toBe("opencode/gpt-5.2-codex")
    expect(r.fallback).toBe(false)
  })

  test("degraded provider is skipped with a reason (fallback)", () => {
    const f = fixture()
    // force a profile whose first model sits on a degraded provider
    f.profiles["test-degraded"] = {
      description: "t",
      models: ["alibaba-token-plan/qwen3.7-max", "opencode/gpt-5.2-codex"],
    }
    const r = resolveProfile("test-degraded", {}, f)
    expect(r.ok).toBe(true)
    expect(r.model).toBe("opencode/gpt-5.2-codex")
    expect(r.fallback).toBe(true)
    const skipped = r.steps.find((s) => s.status === "skipped")
    expect(skipped?.model).toBe("alibaba-token-plan/qwen3.7-max")
    expect(skipped?.reason).toContain("degraded")
  })

  test("--no-fallback always picks the first model, even if degraded", () => {
    const f = fixture()
    f.profiles["test-degraded"] = {
      description: "t",
      models: ["alibaba-token-plan/qwen3.7-max", "opencode/gpt-5.2-codex"],
    }
    const r = resolveProfile("test-degraded", { noFallback: true }, f)
    expect(r.ok).toBe(true)
    expect(r.model).toBe("alibaba-token-plan/qwen3.7-max")
    expect(r.fallback).toBe(false)
  })

  test("experimental models are only used as last resort", () => {
    const f = fixture()
    f.degraded_providers = ["alibaba-token-plan", "deepseek", "nvidia"]
    // long-context: minimax (degraded), deepseek (degraded), gpt-5.2 (ok) — fable never reached
    const r = resolveProfile("long-context", {}, f)
    expect(r.ok).toBe(true)
    expect(r.model).toBe("opencode/gpt-5.2")
  })

  test("no available model → explicit error, no infinite loop", () => {
    const f = fixture()
    f.profiles["all-degraded"] = { description: "t", models: ["alibaba-token-plan/qwen3.7-max"] }
    const r = resolveProfile("all-degraded", {}, f)
    expect(r.ok).toBe(false)
    expect(r.error).toContain("no model")
    // every model got exactly one step — no retries
    expect(r.steps.filter((s) => s.model === "alibaba-token-plan/qwen3.7-max").length).toBe(1)
  })

  test("steps never contain credential values", () => {
    const r = resolveProfile("coding", {}, fixture())
    const text = JSON.stringify(r)
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{4,}/)
    expect(text).not.toMatch(/nvapi-[A-Za-z0-9]/)
  })
})
