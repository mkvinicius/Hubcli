import { expect, test } from "bun:test"
import { spawn } from "bun-pty"

const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1]))

test("allows listeners to register before reading immediate output", async () => {
  const proc = spawn(process.execPath, ["-e", 'process.stdout.write("ready\\n")'], {
    name: "xterm-256color",
    cwd: process.cwd(),
    env,
  })
  let output = ""
  const data = proc.onData((chunk) => {
    output += chunk
  })

  try {
    const event = await Promise.race([
      new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve)),
      Bun.sleep(2_000).then(() => {
        throw new Error("timed out waiting for the immediate PTY output")
      }),
    ])
    expect(event.exitCode).toBe(0)
    expect(output).toContain("ready")
  } finally {
    data.dispose()
    proc.kill()
  }
})

test("replays an exit that occurs before onExit is registered", async () => {
  const proc = spawn(process.execPath, ["-e", "process.exit(7)"], {
    name: "xterm-256color",
    cwd: process.cwd(),
    env,
  })

  try {
    await Bun.sleep(250)
    const event = await Promise.race([
      new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve)),
      Bun.sleep(2_000).then(() => {
        throw new Error("timed out waiting for the replayed PTY exit")
      }),
    ])
    expect(event.exitCode).toBe(7)
  } finally {
    proc.kill()
  }
})
