/**
 * Tests for `hubcli mcp serve` — tool functions (unit) and stdio protocol
 * (subprocess). No real credentials are used; fixtures only.
 */

import { describe, test, expect, afterAll, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { execFileSync } from "child_process"
import {
  toolModels,
  toolProjectStatus,
  toolGitStatus,
  toolMaintenancePreview,
  clientCwd,
  TOOLS,
} from "../../../src/cli/hubcli/mcp-serve"
import { MODEL_REGISTRY } from "../../../src/cli/hubcli/model-registry"

const BUN = path.join(os.homedir(), ".bun", "bin", "bun")
const CLI_ENTRY = path.join(import.meta.dir, "../../../src/index.ts")

let tmpDirs: string[] = []
function tmpdir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}

afterAll(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {}
  }
})

function parseText(result: { content: { type: string; text: string }[] }): any {
  return JSON.parse(result.content[0].text)
}

const savedCallerPwd = process.env["HUBCLI_CALLER_PWD"]
afterEach(() => {
  if (savedCallerPwd === undefined) delete process.env["HUBCLI_CALLER_PWD"]
  else process.env["HUBCLI_CALLER_PWD"] = savedCallerPwd
})

describe("model registry", () => {
  test("has exactly 16 entries, matching the TUI display map count", () => {
    expect(MODEL_REGISTRY.length).toBe(16)
  })

  test("exactly one experimental entry (Fable 5)", () => {
    const exp = MODEL_REGISTRY.filter((e) => e.experimental)
    expect(exp.length).toBe(1)
    expect(exp[0].modelID).toBe("claude-fable-5")
  })
})

describe("TOOLS table", () => {
  test("exposes exactly the six read-only tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "hubcli_doctor",
      "hubcli_git_status",
      "hubcli_maintenance_preview",
      "hubcli_maintenance_status",
      "hubcli_models",
      "hubcli_project_status",
    ])
  })

  test("no tool name suggests write access", () => {
    for (const t of TOOLS) {
      expect(t.name).not.toMatch(/write|edit|commit|push|exec|run|delete|rm/)
    }
  })
})

describe("toolModels", () => {
  test("returns all 16 registry models with required fields", () => {
    const body = parseText(toolModels())
    expect(body.count).toBe(16)
    for (const m of body.models) {
      expect(typeof m.provider).toBe("string")
      expect(typeof m.model_id).toBe("string")
      expect(typeof m.display_name).toBe("string")
      expect(typeof m.group).toBe("string")
      expect(typeof m.experimental).toBe("boolean")
    }
  })

  test("output never contains key-like values", () => {
    const text = JSON.stringify(parseText(toolModels()))
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{4,}/)
    expect(text).not.toMatch(/nvapi-/)
  })
})

describe("toolProjectStatus / toolGitStatus", () => {
  test("non-git directory reports is_git false", () => {
    const d = tmpdir("hubcli-mcp-nogit-")
    process.env["HUBCLI_CALLER_PWD"] = d
    const body = parseText(toolProjectStatus())
    expect(body.cwd).toBe(d)
    expect(body.is_git).toBe(false)
    const git = parseText(toolGitStatus())
    expect(git.is_git).toBe(false)
  })

  test("git repo with staged/modified/untracked counts", () => {
    const d = tmpdir("hubcli-mcp-git-")
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: d })
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: d })
    execFileSync("git", ["config", "user.name", "t"], { cwd: d })
    fs.writeFileSync(path.join(d, "a.txt"), "1")
    execFileSync("git", ["add", "a.txt"], { cwd: d })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: d })
    fs.writeFileSync(path.join(d, "a.txt"), "2") // modified
    fs.writeFileSync(path.join(d, "b.txt"), "x") // untracked
    fs.writeFileSync(path.join(d, "package.json"), "{}")

    process.env["HUBCLI_CALLER_PWD"] = d
    const body = parseText(toolProjectStatus())
    expect(body.is_git).toBe(true)
    expect(body.branch).toBe("main")
    expect(body.clean).toBe(false)
    expect(body.modified).toBe(1)
    expect(body.untracked).toBeGreaterThanOrEqual(2)
    expect(body.project_type).toBe("node")

    const git = parseText(toolGitStatus())
    expect(git.is_git).toBe(true)
    expect(git.clean).toBe(false)
    expect(git.last_commit).toContain("init")
  })

  test("clientCwd falls back to process.cwd() for nonexistent override", () => {
    process.env["HUBCLI_CALLER_PWD"] = "/nonexistent/dir/xyz"
    expect(clientCwd()).toBe(process.cwd())
  })
})

describe("toolMaintenancePreview", () => {
  test("fetch=true is always rejected", () => {
    const body = parseText(toolMaintenancePreview({ fetch: true }))
    expect(body.ok).toBe(false)
    expect(body.error).toContain("not allowed")
  })
})

// ---------------------------------------------------------------------------
// Subprocess protocol tests
// ---------------------------------------------------------------------------

const MCP_TIMEOUT = 30_000

async function runMcpSession(lines: string[], env: Record<string, string>): Promise<string[]> {
  const proc = Bun.spawn([BUN, "--conditions=browser", CLI_ENTRY, "mcp", "serve"], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin.write(lines.join("\n") + "\n")
  await proc.stdin.flush()

  // Count how many requests carry an id — that's how many responses we expect.
  const expectedIds = lines.filter((l) => {
    try {
      return JSON.parse(l).id !== undefined
    } catch {
      return false
    }
  }).length

  // Continuously drain stdout in the background; poll the collected lines.
  const collected: string[] = []
  let responses = 0
  const drain = (async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    const reader = proc.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        collected.push(line)
        try {
          if (JSON.parse(line).id !== undefined) responses++
        } catch {}
      }
    }
  })()

  const deadline = Date.now() + 20_000
  while (responses < expectedIds && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  proc.stdin.end()
  await proc.exited
  await drain
  return collected
}

function mcpEnv(): Record<string, string> {
  return {
    HOME: os.homedir(),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "dumb",
    HUBCLI_BRAND: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  }
}

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
const INITIALIZED = '{"jsonrpc":"2.0","method":"notifications/initialized"}'

describe("mcp serve — stdio protocol", () => {
  test(
    "stdout carries only JSON-RPC; initialize + tools/list work; exits on EOF",
    async () => {
      const out = await runMcpSession([INIT, INITIALIZED, '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'], mcpEnv())
      for (const line of out) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
      const list = out.map((l) => JSON.parse(l)).find((d) => d.id === 2)
      expect(list.result.tools.length).toBe(6)
    },
    MCP_TIMEOUT,
  )

  test(
    "invalid JSON line does not kill the server",
    async () => {
      const out = await runMcpSession(
        [INIT, INITIALIZED, "this is not json {{{", '{"jsonrpc":"2.0","id":9,"method":"tools/list"}'],
        mcpEnv(),
      )
      const list = out.map((l) => JSON.parse(l)).find((d) => d.id === 9)
      expect(list?.result?.tools?.length).toBe(6)
    },
    MCP_TIMEOUT,
  )

  test(
    "unknown method gets a JSON-RPC error, not a crash",
    async () => {
      const out = await runMcpSession(
        [INIT, INITIALIZED, '{"jsonrpc":"2.0","id":7,"method":"does/notexist"}', '{"jsonrpc":"2.0","id":8,"method":"tools/list"}'],
        mcpEnv(),
      )
      const parsed = out.map((l) => JSON.parse(l))
      const errResp = parsed.find((d) => d.id === 7)
      expect(errResp?.error).toBeDefined()
      const list = parsed.find((d) => d.id === 8)
      expect(list?.result?.tools?.length).toBe(6)
    },
    MCP_TIMEOUT,
  )

  test(
    "mcp serve is NOT available without HUBCLI_BRAND",
    async () => {
      const env = mcpEnv()
      delete env["HUBCLI_BRAND"]
      const proc = Bun.spawn([BUN, "--conditions=browser", CLI_ENTRY, "mcp", "serve"], {
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      proc.stdin.end()
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
      // yargs strict mode rejects the unknown subcommand
      expect(exitCode).not.toBe(0)
      expect(stderr).not.toContain("hubcli mcp serve: ready")
    },
    MCP_TIMEOUT,
  )

  test(
    "tool responses never include credential env values",
    async () => {
      const env = mcpEnv()
      env["DASHSCOPE_API_KEY"] = "fake-dash-secret-never-print"
      env["NVIDIA_API_KEY"] = "nvapi-fake-secret-never-print"
      const out = await runMcpSession(
        [INIT, INITIALIZED, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hubcli_doctor","arguments":{}}}'],
        env,
      )
      const all = out.join("\n")
      expect(all).not.toContain("fake-dash-secret-never-print")
      expect(all).not.toContain("nvapi-fake-secret-never-print")
      const resp = out.map((l) => JSON.parse(l)).find((d) => d.id === 3)
      const body = JSON.parse(resp.result.content[0].text)
      expect(body.credentials_presence.DASHSCOPE_API_KEY).toBe(true)
      expect(body.credentials_presence.NVIDIA_API_KEY).toBe(true)
    },
    MCP_TIMEOUT,
  )
})
