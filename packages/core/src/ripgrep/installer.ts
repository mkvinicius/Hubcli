import path from "path"
import { Deferred, Effect } from "effect"
import type { FSUtil } from "../fs-util"

type Pending = Deferred.Deferred<string, Error>

const pending = new Map<string, Pending>()

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function coalesce(key: string, body: Effect.Effect<string, Error>) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = pending.get(key)
      if (current) return yield* restore(Deferred.await(current))

      const done = Deferred.makeUnsafe<string, Error>()
      pending.set(key, done)

      const exit = yield* restore(body).pipe(Effect.exit)
      if (pending.get(key) === done) pending.delete(key)
      Deferred.doneUnsafe(done, exit)
      return yield* exit
    }),
  )
}

export namespace RipgrepInstaller {
  export interface Input {
    readonly fs: FSUtil.Interface
    readonly key: string
    readonly target: string
    readonly archiveName: string
    readonly temporaryPrefix: string
    readonly lock: (body: Effect.Effect<string, Error>) => Effect.Effect<string, Error>
    readonly download: (archive: string) => Effect.Effect<void, Error>
    readonly extract: (archive: string, directory: string) => Effect.Effect<string, Error>
    readonly prepare: (executable: string) => Effect.Effect<void, Error>
    readonly validate: (executable: string) => Effect.Effect<boolean, Error>
  }

  export function install(input: Input): Effect.Effect<string, Error> {
    const root = path.dirname(input.target)

    const valid = (file: string) => input.validate(file).pipe(Effect.catch(() => Effect.succeed(false)))

    const cleanTemporary = input.fs.readDirectoryEntries(root).pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries.filter((entry) => entry.name.startsWith(input.temporaryPrefix)),
          (entry) => input.fs.remove(path.join(root, entry.name), { recursive: true, force: true }),
          { concurrency: "unbounded", discard: true },
        ),
      ),
      Effect.mapError(asError),
    )

    const perform = input.lock(
      Effect.scoped(
        Effect.gen(function* () {
          yield* input.fs.ensureDir(root).pipe(Effect.mapError(asError))
          yield* cleanTemporary

          if (yield* valid(input.target)) return input.target

          const temporary = yield* input.fs
            .makeTempDirectoryScoped({
              directory: root,
              prefix: input.temporaryPrefix,
            })
            .pipe(Effect.mapError(asError))
          const archive = path.join(temporary, input.archiveName)
          const extracted = path.join(temporary, "extracted")

          yield* input.fs.makeDirectory(extracted).pipe(Effect.mapError(asError))
          yield* input.download(archive)
          const candidate = yield* input.extract(archive, extracted)
          yield* input.prepare(candidate)

          if (!(yield* valid(candidate))) {
            return yield* Effect.fail(new Error(`Downloaded ripgrep executable is invalid: ${candidate}`))
          }

          if (yield* valid(input.target)) return input.target

          yield* input.fs.remove(input.target, { recursive: true, force: true }).pipe(Effect.mapError(asError))
          yield* input.fs.rename(candidate, input.target).pipe(Effect.mapError(asError))

          if (yield* valid(input.target)) return input.target

          yield* input.fs.remove(input.target, { recursive: true, force: true }).pipe(Effect.ignore)
          return yield* Effect.fail(new Error(`Published ripgrep executable is invalid: ${input.target}`))
        }),
      ),
    )

    return Effect.gen(function* () {
      if (yield* valid(input.target)) {
        yield* cleanTemporary.pipe(Effect.ignore)
        return input.target
      }
      return yield* coalesce(input.key, perform)
    }).pipe(Effect.mapError(asError))
  }
}
