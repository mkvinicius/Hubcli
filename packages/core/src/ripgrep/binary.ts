import { createHash } from "crypto"
import path from "path"
import whichPkg from "which"
import { Context, Duration, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { makeGlobalNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { AppProcess } from "../process"
import { EffectFlock } from "../util/effect-flock"
import { RipgrepInstaller } from "./installer"

export namespace RipgrepBinary {
  export const VERSION = "15.1.0"
  export const PLATFORM = {
    "arm64-darwin": {
      platform: "aarch64-apple-darwin",
      extension: "tar.gz",
      sha256: "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
    },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
      sha256: "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
    },
    "x64-darwin": {
      platform: "x86_64-apple-darwin",
      extension: "tar.gz",
      sha256: "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
    },
    "x64-linux": {
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
      sha256: "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
    },
    "arm64-win32": {
      platform: "aarch64-pc-windows-msvc",
      extension: "zip",
      sha256: "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
    },
    "ia32-win32": {
      platform: "i686-pc-windows-msvc",
      extension: "zip",
      sha256: "725be85a1e8f92878a548f40ee4f6df64bc93b809586462b3c6d884e1de1e83a",
    },
    "x64-win32": {
      platform: "x86_64-pc-windows-msvc",
      extension: "zip",
      sha256: "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
    },
  } as const

  const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
  const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024

  type Asset = (typeof PLATFORM)[keyof typeof PLATFORM]

  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

  export function asset(arch: string, platform: string): Asset | undefined {
    return PLATFORM[`${arch}-${platform}` as keyof typeof PLATFORM]
  }

  export function checksum(bytes: Uint8Array) {
    return createHash("sha256").update(bytes).digest("hex")
  }

  export function checksumMatches(bytes: Uint8Array, expected: string) {
    return checksum(bytes) === expected
  }

  function asError(cause: unknown) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }

  function executableName(platform: string) {
    return platform === "win32" ? "rg.exe" : "rg"
  }

  function findOnPath(command: string) {
    const search = process.env.PATH ?? process.env.Path ?? ""
    const result = whichPkg.sync(command, {
      nothrow: true,
      path: search,
      pathExt: process.env.PATHEXT ?? process.env.PathExt,
    })
    return typeof result === "string" ? result : undefined
  }

  function powershellLiteral(value: string) {
    return `'${value.replaceAll("'", "''")}'`
  }

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const appProcess = yield* AppProcess.Service
      const flock = yield* EffectFlock.Service

      const run = Effect.fnUntraced(function* (command: string, args: string[], timeout: Duration.Input) {
        const result = yield* appProcess
          .run(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }), {
            timeout,
            maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
            maxErrorBytes: MAX_PROCESS_OUTPUT_BYTES,
          })
          .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.mapError(asError))
        return {
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      })

      const validate = (file: string, expectedVersion?: string) =>
        Effect.gen(function* () {
          if (!(yield* fs.isFile(file))) return false
          const result = yield* run(file, ["--version"], "5 seconds")
          const first = result.stdout.split(/\r?\n/, 1)[0]?.trim() ?? ""
          if (!expectedVersion) return /^ripgrep \d+\.\d+\.\d+(?:\s|$)/.test(first)
          return first === `ripgrep ${expectedVersion}` || first.startsWith(`ripgrep ${expectedVersion} `)
        }).pipe(Effect.catch(() => Effect.succeed(false)))

      const extract = Effect.fnUntraced(function* (
        archive: string,
        directory: string,
        config: Asset,
        hostPlatform: string,
      ) {
        if (config.extension === "zip") {
          const shell = findOnPath("powershell.exe") ?? findOnPath("pwsh.exe")
          if (!shell) return yield* Effect.fail(new Error("PowerShell is required to extract ripgrep on Windows"))
          const script = [
            "$ErrorActionPreference = 'Stop'",
            "Add-Type -AssemblyName System.IO.Compression.FileSystem",
            `[System.IO.Compression.ZipFile]::ExtractToDirectory(${powershellLiteral(archive)}, ${powershellLiteral(directory)})`,
          ].join("; ")
          yield* run(shell, ["-NoProfile", "-NonInteractive", "-Command", script], "30 seconds")
        } else {
          const tar = findOnPath(hostPlatform === "win32" ? "tar.exe" : "tar") ?? "tar"
          yield* run(tar, ["-xzf", archive, "-C", directory], "30 seconds")
        }

        return path.join(directory, `ripgrep-${VERSION}-${config.platform}`, executableName(hostPlatform))
      })

      const resolve = Effect.gen(function* () {
        const hostPlatform = process.platform
        const hostArch = process.arch
        const name = executableName(hostPlatform)

        const system = findOnPath(name)
        if (system && (yield* validate(system))) return system

        const legacy = path.join(global.bin, name)
        if (yield* validate(legacy, VERSION)) return legacy

        const config = asset(hostArch, hostPlatform)
        if (!config)
          return yield* Effect.fail(new Error(`unsupported platform for ripgrep: ${hostArch}-${hostPlatform}`))

        const platformKey = `${hostArch}-${hostPlatform}`
        const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
        const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
        const target = path.join(global.bin, `rg-${VERSION}-${platformKey}${hostPlatform === "win32" ? ".exe" : ""}`)
        const key = `ripgrep:${VERSION}:${platformKey}:${path.resolve(target)}`
        const lockKey = `ripgrep-publish:${path.resolve(target)}`

        return yield* RipgrepInstaller.install({
          fs,
          key,
          target,
          archiveName: filename,
          temporaryPrefix: `.ripgrep-${VERSION}-${platformKey}-install-`,
          lock: (body) => flock.withLock(body, lockKey).pipe(Effect.mapError(asError)),
          download: (archive) =>
            Effect.gen(function* () {
              yield* Effect.logInfo("downloading ripgrep", { url })
              const bytes = yield* HttpClientRequest.get(url).pipe(
                http.execute,
                Effect.flatMap((response) => response.arrayBuffer),
                Effect.timeoutOrElse({
                  duration: "2 minutes",
                  orElse: () => Effect.fail(new Error(`timed out downloading ripgrep from ${url}`)),
                }),
                Effect.mapError(asError),
                Effect.map((value) => new Uint8Array(value)),
              )
              if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
                return yield* Effect.fail(
                  new Error(`invalid ripgrep archive size from ${url}: ${bytes.byteLength} bytes`),
                )
              }
              const actual = checksum(bytes)
              if (actual !== config.sha256) {
                return yield* Effect.fail(
                  new Error(`ripgrep checksum mismatch for ${filename}: expected ${config.sha256}, received ${actual}`),
                )
              }
              yield* fs.writeFile(archive, bytes).pipe(Effect.mapError(asError))
            }),
          extract: (archive, directory) => extract(archive, directory, config, hostPlatform),
          prepare: (candidate) =>
            hostPlatform === "win32" ? Effect.void : fs.chmod(candidate, 0o755).pipe(Effect.mapError(asError)),
          validate: (candidate) => validate(candidate, VERSION),
        })
      })

      let resolved: string | undefined
      const filepath = Effect.suspend(() => {
        if (resolved) return Effect.succeed(resolved)
        return resolve.pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              resolved = value
            }),
          ),
        )
      })

      return Service.of({ filepath })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer,
    deps: [FSUtil.node, Global.node, httpClient, AppProcess.node, EffectFlock.node],
  })
}
