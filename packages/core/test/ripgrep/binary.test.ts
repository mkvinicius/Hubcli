import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { EXECUTABLE, bytes } from "../fixture/ripgrep-windows-archive"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))

describe("RipgrepBinary", () => {
  test("maps every supported host to the official release asset", () => {
    expect(RipgrepBinary.asset("x64", "win32")).toMatchObject({
      platform: "x86_64-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("arm64", "win32")).toMatchObject({
      platform: "aarch64-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("ia32", "win32")).toMatchObject({
      platform: "i686-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("x64", "darwin")).toMatchObject({
      platform: "x86_64-apple-darwin",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("arm64", "darwin")).toMatchObject({
      platform: "aarch64-apple-darwin",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("x64", "linux")).toMatchObject({
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("arm64", "linux")).toMatchObject({
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("s390x", "linux")).toBeUndefined()
  })

  test("accepts complete bytes only when their SHA-256 matches", () => {
    const complete = new TextEncoder().encode("complete archive fixture")
    const expected = RipgrepBinary.checksum(complete)
    const partial = complete.slice(0, 8)

    expect(RipgrepBinary.checksumMatches(complete, expected)).toBe(true)
    expect(RipgrepBinary.checksumMatches(partial, expected)).toBe(false)
    expect(RipgrepBinary.checksumMatches(new Uint8Array(), expected)).toBe(false)
  })

  test("ships a 64-character lowercase SHA-256 for every asset", () => {
    for (const item of Object.values(RipgrepBinary.PLATFORM)) {
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test("selects native Windows tar even when Git tar appears first on PATH", () => {
    const systemRoot = String.raw`C:\Windows`
    const git = String.raw`C:\Program Files\Git\usr\bin`
    const gitTar = path.win32.join(git, "tar.exe")
    const tar = RipgrepBinary.windowsTarPath({
      SystemRoot: systemRoot,
      PATH: `${git};${path.win32.join(systemRoot, "System32")}`,
    })

    expect(tar).not.toBe(gitTar)
    expect(tar).toBe(path.win32.join(systemRoot, "System32", "tar.exe"))
  })

  it.live(
    "extracts the Windows ZIP with the platform tar and captures process completion",
    () => {
      if (process.platform !== "win32" && process.platform !== "darwin") return Effect.void
      return Effect.acquireUseRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode ripgrep archive "))),
        (root) =>
          Effect.gen(function* () {
            const archive = path.join(root, "archive with spaces.zip")
            const directory = path.join(root, "destination with spaces")
            yield* Effect.promise(() => fs.writeFile(archive, bytes()))
            yield* Effect.promise(() => fs.mkdir(directory))

            const tar = process.platform === "win32" ? RipgrepBinary.windowsTarPath(process.env) : "tar"
            if (!tar) return yield* Effect.fail(new Error("platform tar is required for the offline ZIP test"))

            const result = yield* (yield* AppProcess.Service)
              .run(
                ChildProcess.make(tar, ["-xf", path.basename(archive), "-C", directory], {
                  cwd: root,
                  stdin: "ignore",
                }),
                { timeout: "5 seconds" },
              )
              .pipe(Effect.flatMap(AppProcess.requireSuccess))

            expect(result.exitCode).toBe(0)
            expect(
              (yield* Effect.promise(() => fs.stat(path.join(directory, ...EXECUTABLE.split("/"))))).isFile(),
            ).toBe(true)
          }),
        (root) => Effect.promise(() => fs.rm(root, { recursive: true, force: true })),
      )
    },
    10_000,
  )
})
