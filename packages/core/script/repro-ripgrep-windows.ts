import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import which from "which"
import { EXECUTABLE, bytes } from "../test/fixture/ripgrep-windows-archive"

const repetitions = Math.max(1, Number.parseInt(process.argv[2] ?? "5", 10) || 5)
const timeout = 5_000
const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode ripgrep process "))
const archive = path.join(root, "small archive.zip")
await fs.writeFile(archive, bytes())

type Event = {
  readonly event: "spawn" | "exit" | "close" | "error" | "rg.exe" | "marker"
  readonly elapsedMs: number
  readonly code?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly detail?: string
}

function elapsed(started: number) {
  return Math.round((performance.now() - started) * 100) / 100
}

function alive(pid: number | undefined) {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  )
}

async function observe(
  name: string,
  command: string,
  args: string[],
  iteration: number,
  stdio: "pipe" | "overlapped",
  env?: NodeJS.ProcessEnv,
  cwd?: string,
) {
  const directory = path.join(root, `${name} ${iteration}`)
  const marker = path.join(directory, "extraction-complete")
  const executable = path.join(directory, ...EXECUTABLE.split("/"))
  await fs.mkdir(directory)

  const started = performance.now()
  const events: Event[] = []
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdio, stdio],
    windowsHide: true,
  })

  child.on("spawn", () => events.push({ event: "spawn", elapsedMs: elapsed(started) }))
  child.on("exit", (code, signal) => events.push({ event: "exit", elapsedMs: elapsed(started), code, signal }))
  child.on("close", (code, signal) => events.push({ event: "close", elapsedMs: elapsed(started), code, signal }))
  child.on("error", (error) => events.push({ event: "error", elapsedMs: elapsed(started), detail: error.message }))
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

  let checking = false
  const observed = new Set<string>()
  const poll = setInterval(async () => {
    if (checking) return
    checking = true
    if (!observed.has("rg.exe") && (await exists(executable))) {
      observed.add("rg.exe")
      events.push({ event: "rg.exe", elapsedMs: elapsed(started) })
    }
    if (!observed.has("marker") && (await exists(marker))) {
      observed.add("marker")
      events.push({ event: "marker", elapsedMs: elapsed(started) })
    }
    checking = false
  }, 10)

  const closed = new Promise<boolean>((resolve) => {
    child.once("close", () => resolve(true))
    child.once("error", () => resolve(true))
  })
  const expired = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => expired.resolve(false), timeout)
  const completed = await Promise.race([closed, expired.promise])
  clearTimeout(timer)
  clearInterval(poll)

  const aliveAtTimeout = completed ? false : alive(child.pid)
  if (!completed && child.pid !== undefined) {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    } else {
      child.kill("SIGKILL")
    }
    await Promise.race([
      closed,
      new Promise((resolve) => {
        setTimeout(resolve, 2_000)
      }),
    ])
  }

  if (!observed.has("rg.exe") && (await exists(executable))) {
    events.push({ event: "rg.exe", elapsedMs: elapsed(started) })
  }
  if (!observed.has("marker") && (await exists(marker))) {
    events.push({ event: "marker", elapsedMs: elapsed(started) })
  }

  console.log(
    JSON.stringify({
      name,
      iteration,
      timestamp: new Date().toISOString(),
      command,
      args,
      cwd,
      stdio,
      pid: child.pid,
      events,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      archiveExists: await exists(archive),
      executableExists: await exists(executable),
      markerExists: await exists(marker),
      aliveAtTimeout,
      aliveAfterClose: alive(child.pid),
      durationMs: elapsed(started),
    }),
  )
}

const powershell = which.sync("powershell.exe", { nothrow: true })
const pwsh = which.sync("pwsh.exe", { nothrow: true })
const tar = which.sync(process.platform === "win32" ? "tar.exe" : "tar", { nothrow: true })
const script = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  "[System.IO.Compression.ZipFile]::ExtractToDirectory($env:OPENCODE_ARCHIVE, $env:OPENCODE_DESTINATION)",
  "[System.IO.File]::WriteAllText($env:OPENCODE_MARKER, 'complete')",
].join("; ")

try {
  for (let iteration = 1; iteration <= repetitions; iteration++) {
    for (const stdio of ["pipe", "overlapped"] as const) {
      if (powershell) {
        const name = `WindowsPowerShell-${stdio}`
        const directory = path.join(root, `${name} ${iteration}`)
        await observe(name, powershell, ["-NoProfile", "-NonInteractive", "-Command", script], iteration, stdio, {
          ...process.env,
          OPENCODE_ARCHIVE: archive,
          OPENCODE_DESTINATION: directory,
          OPENCODE_MARKER: path.join(directory, "extraction-complete"),
        })
      }
      if (pwsh) {
        const name = `pwsh-${stdio}`
        const directory = path.join(root, `${name} ${iteration}`)
        await observe(name, pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], iteration, stdio, {
          ...process.env,
          OPENCODE_ARCHIVE: archive,
          OPENCODE_DESTINATION: directory,
          OPENCODE_MARKER: path.join(directory, "extraction-complete"),
        })
      }
      if (tar) {
        const name = `tar-${stdio}`
        await observe(
          name,
          tar,
          ["-xf", path.basename(archive), "-C", path.join(root, `${name} ${iteration}`)],
          iteration,
          stdio,
          undefined,
          path.dirname(archive),
        )
      }
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
