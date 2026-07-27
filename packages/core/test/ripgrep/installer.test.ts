import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RipgrepInstaller } from "@opencode-ai/core/ripgrep/installer"

const layer = LayerNode.compile(FSUtil.node)
const prefix = ".ripgrep-test-install-"

type State = {
  downloads: number
  extractions: number
  locks: number
  failDownload: boolean
  failExtraction: boolean
  missingCandidate: boolean
  invalidCandidate: boolean
  rejectPublished: boolean
}

function state(): State {
  return {
    downloads: 0,
    extractions: 0,
    locks: 0,
    failDownload: false,
    failExtraction: false,
    missingCandidate: false,
    invalidCandidate: false,
    rejectPublished: false,
  }
}

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function run<A, E>(effect: Effect.Effect<A, E, FSUtil.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

async function fixture<A>(body: (root: string) => Promise<A>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-ripgrep-installer-"))
  try {
    return await body(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function temporaryEntries(root: string) {
  return (await fs.readdir(root).catch(() => [])).filter((name) => name.startsWith(prefix))
}

function installInput(root: string, afs: FSUtil.Interface, current: State): RipgrepInstaller.Input {
  const target = path.join(root, process.platform === "win32" ? "rg-test.exe" : "rg-test")
  return {
    fs: afs,
    key: `test:${target}`,
    target,
    archiveName: "ripgrep.test",
    temporaryPrefix: prefix,
    lock: (body) =>
      Effect.gen(function* () {
        current.locks += 1
        return yield* body
      }),
    download: (archive) =>
      attempt(async () => {
        current.downloads += 1
        await fs.writeFile(archive, "complete archive")
        if (current.failDownload) throw new Error("download failed")
      }),
    extract: (_archive, directory) =>
      attempt(async () => {
        current.extractions += 1
        const candidate = path.join(directory, process.platform === "win32" ? "rg.exe" : "rg")
        if (current.failExtraction) {
          await fs.writeFile(candidate, "partial")
          throw new Error("extraction failed")
        }
        if (!current.missingCandidate) {
          await fs.writeFile(candidate, current.invalidCandidate ? "invalid" : "valid")
        }
        return candidate
      }),
    prepare: () => Effect.void,
    validate: (file) =>
      attempt(async () => {
        if (current.rejectPublished && file === target) return false
        const info = await fs.stat(file)
        return info.isFile() && (await fs.readFile(file, "utf8")) === "valid"
      }).pipe(Effect.catch(() => Effect.succeed(false))),
  }
}

describe("RipgrepInstaller", () => {
  test("installs into an empty cache and publishes only the validated executable", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const input = installInput(root, afs, current)

          const target = yield* RipgrepInstaller.install(input)

          expect(yield* attempt(() => fs.readFile(target, "utf8"))).toBe("valid")
          expect(current.downloads).toBe(1)
          expect(current.extractions).toBe(1)
          expect(current.locks).toBe(1)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("uses a valid cache without downloading and removes stale temporary directories", () =>
    fixture(async (root) => {
      const target = path.join(root, process.platform === "win32" ? "rg-test.exe" : "rg-test")
      const stale = path.join(root, `${prefix}orphan`)
      await fs.writeFile(target, "valid")
      await fs.mkdir(stale)
      await fs.writeFile(path.join(stale, "partial"), "partial")

      await run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const result = yield* RipgrepInstaller.install(installInput(root, afs, current))

          expect(result).toBe(target)
          expect(current.downloads).toBe(0)
          expect(current.extractions).toBe(0)
          expect(current.locks).toBe(0)
        }),
      )

      expect(await temporaryEntries(root)).toEqual([])
    }))

  test("coalesces concurrent callers into one download and one extraction", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const input = installInput(root, afs, current)
          const targets = yield* Effect.all(
            Array.from({ length: 12 }, () => RipgrepInstaller.install(input)),
            { concurrency: "unbounded" },
          )

          expect(new Set(targets).size).toBe(1)
          expect(current.downloads).toBe(1)
          expect(current.extractions).toBe(1)
          expect(current.locks).toBe(1)
          expect(yield* attempt(() => fs.readFile(targets[0], "utf8"))).toBe("valid")
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("cleans a partial download and allows retry after failure", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const input = installInput(root, afs, current)
          current.failDownload = true

          const first = yield* RipgrepInstaller.install(input).pipe(Effect.exit)
          expect(Exit.isFailure(first)).toBe(true)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
          expect(yield* afs.existsSafe(input.target)).toBe(false)

          current.failDownload = false
          const target = yield* RipgrepInstaller.install(input)
          expect(yield* attempt(() => fs.readFile(target, "utf8"))).toBe("valid")
          expect(current.downloads).toBe(2)
          expect(current.extractions).toBe(1)
        }),
      ),
    ))

  test("cleans a partial extraction and allows retry after failure", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const input = installInput(root, afs, current)
          current.failExtraction = true

          const first = yield* RipgrepInstaller.install(input).pipe(Effect.exit)
          expect(Exit.isFailure(first)).toBe(true)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
          expect(yield* afs.existsSafe(input.target)).toBe(false)

          current.failExtraction = false
          const target = yield* RipgrepInstaller.install(input)
          expect(yield* attempt(() => fs.readFile(target, "utf8"))).toBe("valid")
          expect(current.downloads).toBe(2)
          expect(current.extractions).toBe(2)
        }),
      ),
    ))

  test("rejects an archive with no executable and leaves no cache entry", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          current.missingCandidate = true
          const input = installInput(root, afs, current)

          const result = yield* RipgrepInstaller.install(input).pipe(Effect.exit)

          expect(Exit.isFailure(result)).toBe(true)
          expect(yield* afs.existsSafe(input.target)).toBe(false)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("rejects an invalid executable and leaves no cache entry", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          current.invalidCandidate = true
          const input = installInput(root, afs, current)

          const result = yield* RipgrepInstaller.install(input).pipe(Effect.exit)

          expect(Exit.isFailure(result)).toBe(true)
          expect(yield* afs.existsSafe(input.target)).toBe(false)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("replaces a partial target directory with the validated executable", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const input = installInput(root, afs, current)
          yield* afs.makeDirectory(input.target)
          yield* afs.writeFileString(path.join(input.target, "partial"), "partial")

          const target = yield* RipgrepInstaller.install(input)

          expect((yield* attempt(() => fs.stat(target))).isFile()).toBe(true)
          expect(yield* attempt(() => fs.readFile(target, "utf8"))).toBe("valid")
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("removes a target that fails validation after publication", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          current.rejectPublished = true
          const input = installInput(root, afs, current)

          const result = yield* RipgrepInstaller.install(input).pipe(Effect.exit)

          expect(Exit.isFailure(result)).toBe(true)
          expect(yield* afs.existsSafe(input.target)).toBe(false)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))

  test("cancellation settles waiters, cleans temporary files, and permits retry", () =>
    fixture((root) =>
      run(
        Effect.gen(function* () {
          const afs = yield* FSUtil.Service
          const current = state()
          const started = yield* Deferred.make<void>()
          let hang = true
          const base = installInput(root, afs, current)
          const input: RipgrepInstaller.Input = {
            ...base,
            download: (archive) =>
              Effect.gen(function* () {
                current.downloads += 1
                yield* attempt(() => fs.writeFile(archive, "partial"))
                yield* Deferred.succeed(started, undefined)
                if (hang) yield* Effect.never
                yield* attempt(() => fs.writeFile(archive, "complete archive"))
              }),
          }

          const owner = yield* RipgrepInstaller.install(input).pipe(Effect.forkChild)
          yield* Deferred.await(started)
          const waiter = yield* RipgrepInstaller.install(input).pipe(Effect.forkChild)

          yield* Fiber.interrupt(owner)
          const waiterExit = yield* Fiber.await(waiter)
          expect(Exit.isFailure(waiterExit)).toBe(true)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])

          hang = false
          const target = yield* RipgrepInstaller.install(input)
          expect(yield* attempt(() => fs.readFile(target, "utf8"))).toBe("valid")
          expect(current.downloads).toBe(2)
          expect(yield* attempt(() => temporaryEntries(root))).toEqual([])
        }),
      ),
    ))
})
